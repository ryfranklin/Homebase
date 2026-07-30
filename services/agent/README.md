# services/agent/

The AgentCore agent runtime. It orchestrates hybrid retrieval against the Bedrock Knowledge Base,
calls connector MCP tools through AgentCore Gateway, and generates responses with Bedrock.

Configuration (model id, knowledge base id, runtime ARN) arrives as environment variables or
resolved Terraform outputs, never as literals. Keep tenant and user identity explicit in request
and session models.
