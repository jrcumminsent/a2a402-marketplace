"""Minimal a2a402 REST client. The private key never leaves this process."""

from __future__ import annotations

import hashlib
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct


def canonical_json(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


class A2A402Agent:
    def __init__(self, marketplace: str, private_key: str) -> None:
        self.marketplace = marketplace.rstrip("/")
        self.domain = httpx.URL(self.marketplace).host.lower()
        self.account = Account.from_key(private_key)
        self.wallet_address = self.account.address.lower()
        self.agent_id: str | None = None
        self.access_token: str | None = None
        self.http = httpx.Client(base_url=self.marketplace, timeout=15.0)

    def close(self) -> None:
        self.http.close()

    def sign(self, message: str) -> str:
        signed = self.account.sign_message(encode_defunct(text=message))
        return f"0x{bytes(signed.signature).hex()}"

    def discover(self) -> dict[str, Any]:
        documents = {
            "manifest": self._get_json("/"),
            "agent_card": self._get_json("/.well-known/agent-card.json"),
            "openapi": self._get_json("/openapi.json"),
            "health": self._get_json("/health", allowed={200, 503}),
        }
        if documents["manifest"].get("protocol_version") != "a2a402/0.1":
            raise RuntimeError("Marketplace is not compatible with a2a402/0.1")
        return documents

    def register(self, capabilities: list[str]) -> dict[str, Any]:
        unsigned = {
            "wallet_address": self.wallet_address,
            "signing_key": self.wallet_address,
            "external_agent_card_url": None,
            "capabilities": sorted(set(capabilities)),
            "input_modalities": ["application/json"],
            "output_modalities": ["application/json"],
        }
        message = "\n".join(
            [
                "a2a402 agent registration",
                "Protocol: a2a402/0.1",
                canonical_json(unsigned),
            ]
        )
        registered = self.request(
            "POST",
            "/v1/agents",
            {**unsigned, "registration_signature": self.sign(message)},
            authenticated=False,
        )
        self.agent_id = str(registered["id"])
        return registered

    def authenticate(self) -> None:
        if not self.agent_id:
            raise RuntimeError("Register or set agent_id before authenticating")
        challenge = self.request(
            "POST",
            "/v1/auth/challenge",
            {"agent_id": self.agent_id},
            authenticated=False,
        )
        verified = self.request(
            "POST",
            "/v1/auth/verify",
            {
                "nonce_id": challenge["id"],
                "signature": self.sign(str(challenge["challenge"])),
            },
            authenticated=False,
        )
        self.access_token = str(verified["access_token"])

    def request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        *,
        authenticated: bool = True,
    ) -> dict[str, Any]:
        method = method.upper()
        payload = body or {}
        mutation = method in {"POST", "PUT", "PATCH", "DELETE"}
        headers = {"accept": "application/json"}
        if mutation:
            idempotency_key = str(uuid.uuid4())
            signed_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            headers["x-idempotency-key"] = idempotency_key
            if authenticated:
                if not self.agent_id or not self.access_token:
                    raise RuntimeError("Authenticated mutation requires authentication")
                digest = hashlib.sha256(canonical_json(payload).encode()).hexdigest()
                message = "\n".join(
                    [
                        "a2a402 signed request",
                        self.domain,
                        self.agent_id,
                        method,
                        path,
                        idempotency_key,
                        signed_at,
                        digest,
                    ]
                )
                headers.update(
                    {
                        "authorization": f"Bearer {self.access_token}",
                        "x-signed-at": signed_at,
                        "x-agent-signature": self.sign(message),
                    }
                )
        elif authenticated and self.access_token:
            headers["authorization"] = f"Bearer {self.access_token}"
        response = self.http.request(
            method, path, headers=headers, json=payload if mutation else None
        )
        response.raise_for_status()
        return response.json()

    def _get_json(self, path: str, allowed: set[int] = {200}) -> dict[str, Any]:
        response = self.http.get(path, headers={"accept": "application/json"})
        if response.status_code not in allowed:
            response.raise_for_status()
        return response.json()


if __name__ == "__main__":
    key = os.environ.get("AGENT_PRIVATE_KEY")
    if not key:
        raise SystemExit("Set AGENT_PRIVATE_KEY to a dedicated agent wallet key")
    agent = A2A402Agent("https://a2a402.market", key)
    try:
        print(json.dumps(agent.discover(), indent=2))
        # Registration is a durable mutation; uncomment only intentionally.
        # print(agent.register(["research", "application/json"]))
        # agent.authenticate()
    finally:
        agent.close()
