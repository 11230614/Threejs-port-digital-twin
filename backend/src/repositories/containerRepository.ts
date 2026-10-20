import { prisma } from "../db/pool.js";

const fields = `database_id AS "databaseId", business_id AS "businessId", entity_id AS "entityId",
  asset_id AS "assetId", block_id AS "blockId", area, slot, state, location`;

export const containerRepository = Object.freeze({
  async synchronizeSceneSnapshot(containers) {
    if (!prisma) return { synchronized: false, count: 0 };
    if (containers.length === 0) return { synchronized: true, count: 0 };
    try {
      return await prisma.$transaction(async (tx) => {
      const existingRows = await tx.containers.findMany({ where: { business_id: { in: containers.map((item) => item.businessId) } }, select: { business_id: true } });
      const existing = new Set(existingRows.map((row) => row.business_id));
      let rowCount = 0;
      for (let start = 0; start < containers.length; start += 1000) {
        const chunk = containers.slice(start, start + 1000);
        for (const item of chunk) {
          const persisted = await tx.$executeRaw`INSERT INTO containers (business_id, entity_id, asset_id, block_id, area, slot, state, location) VALUES (${item.businessId}, ${item.entityId}, ${item.assetId}, ${item.blockId}, ${item.area}, ${JSON.stringify(item.slot)}::jsonb, 'YARD', ${item.location}) ON CONFLICT (business_id) DO UPDATE SET entity_id = COALESCE(EXCLUDED.entity_id, containers.entity_id), asset_id = EXCLUDED.asset_id, block_id = EXCLUDED.block_id, area = EXCLUDED.area, slot = EXCLUDED.slot, location = CASE WHEN containers.state = 'YARD' THEN EXCLUDED.location ELSE containers.location END, updated_at = CURRENT_TIMESTAMP`;
          rowCount += persisted;
        }
      }
      return { synchronized: true, count: rowCount, created: containers.length - existing.size, existing: existing.size };
      });
    } catch (error) { throw error; }
  },

  async findDatabaseIdByBusinessId(businessId) {
    if (!prisma) return null;
    const result = await prisma.containers.findUnique({ where: { business_id: businessId }, select: { database_id: true } });
    return result?.database_id.toString() ?? null;
  },

  async findBusinessIdByDatabaseId(databaseId) {
    if (!prisma) return null;
    const result = await prisma.containers.findUnique({ where: { database_id: BigInt(databaseId) }, select: { business_id: true } });
    return result?.business_id ?? null;
  },

  async findByBusinessId(businessId) {
    if (!prisma) return null;
    const row = await prisma.containers.findUnique({ where: { business_id: businessId } });
    return row ? mapContainer(row) : null;
  },

  async findByDatabaseId(databaseId) {
    if (!prisma) return null;
    const row = await prisma.containers.findUnique({ where: { database_id: BigInt(databaseId) } });
    return row ? mapContainer(row) : null;
  },

  async list({ state, page = 1, pageSize = 50 } = {}) {
    if (!prisma) return { items: [], total: 0 };
    const where = state ? { state } : undefined;
    const [total, rows] = await prisma.$transaction([
      prisma.containers.count({ where }),
      prisma.containers.findMany({ where, orderBy: { business_id: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { items: rows.map(mapContainer), total };
  },
});

function mapContainer(row) {
  return { databaseId: row.database_id.toString(), businessId: row.business_id, entityId: row.entity_id, assetId: row.asset_id, blockId: row.block_id, area: row.area, slot: row.slot, state: row.state, location: row.location };
}
