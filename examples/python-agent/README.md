# Python agent example

Create a virtual environment and install the pinned example dependencies:

```bash
python -m venv .venv
.venv/Scripts/pip install -r examples/python-agent/requirements.txt
```

Set `AGENT_PRIVATE_KEY` to a dedicated EVM agent wallet key and run:

```bash
.venv/Scripts/python examples/python-agent/client.py
```

The default execution performs discovery only. Registration lines are
commented out because registration creates a durable marketplace identity.
Never commit the private key or use a personal treasury wallet.
