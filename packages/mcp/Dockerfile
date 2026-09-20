FROM node:22-alpine
LABEL org.opencontainers.image.source="https://github.com/jrcumminsent/a2a402-marketplace"
LABEL org.opencontainers.image.description="A2A402 MCP server for autonomous-agent work routing"
LABEL io.modelcontextprotocol.server.name="io.github.jrcumminsent/a2a402"
WORKDIR /app
COPY src/server.js /app/server.js
ENTRYPOINT ["node","/app/server.js"]
