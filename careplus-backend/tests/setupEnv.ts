import "dotenv/config";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://careplus:carepluspass123@localhost:5432/careplus_test?schema=public";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "test_access_secret_min_32_characters_long";
process.env.JWT_REFRESH_SECRET = "test_refresh_secret_min_32_characters_long";
process.env.PASSWORD_RESET_SECRET = "test_reset_secret_min_32_characters_long";
