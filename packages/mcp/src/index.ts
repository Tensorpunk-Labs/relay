import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.js';

const server = new Server(
  { name: 'relay-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

async function main() {
  await registerTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Relay MCP server running on stdio');
}

main().catch(console.error);
