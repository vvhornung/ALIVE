// Test environment: fake identity, in-memory DB. Nothing here reaches the network.
process.env.OP_WALLET_ADDRESS_URL = "https://ilp.interledger-test.dev/alive-test";
process.env.OP_KEY_ID = "test-key-id";
process.env.OP_PRIVATE_KEY = "test-private-key";
process.env.APP_BASE_URL = "http://localhost:3000";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.STRICT_HASH = "false";
process.env.DATABASE_PATH = ":memory:";
