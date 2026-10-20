import { PrismaClient } from "@prisma/client";

export const prisma = process.env.DATABASE_URL ? new PrismaClient({ log: ["error"] }) : null;
export const pool = null;

export async function checkDatabaseConnection() {
  if (!prisma) return { connected: false, message: "DATABASE_URL 未配置" };
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { connected: true };
  } catch (error) {
    console.error("PostgreSQL connection check failed:", error instanceof Error ? error.message : error);
    return { connected: false, message: "无法连接 PostgreSQL" };
  }
}

export async function closeDatabasePool() {
  if (prisma) await prisma.$disconnect();
}
