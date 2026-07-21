#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createAnviLtsServer } from "./registry.ts";

const server = createAnviLtsServer();
await server.connect(new StdioServerTransport());
