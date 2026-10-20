import { devices } from "../data/devices.js";
import { prisma } from "../db/pool.js";

export const deviceTypes = Object.freeze(["agv"]);

export const deviceRepository = Object.freeze({
  async createMany(items) {
    if (!prisma) return devices;
    if (!items.length) return [];
    await prisma.$transaction(items.map((device) => prisma.devices.upsert({
      where: { id: device.id },
      create: { id: device.id, entity_id: device.entityId, name: device.name, type: device.type },
      update: { entity_id: device.entityId, name: device.name, type: device.type },
    })));
    return this.list();
  },
  async list({ type } = {}) {
    if (prisma) {
      const result = await prisma.devices.findMany({ where: type ? { type } : undefined, orderBy: { id: "asc" } });
      return result.map(({ id, entity_id, name, type }) => ({ id, entityId: entity_id, name, type }));
    }
    return devices.filter((device) => !type || device.type === type).slice().sort((a, b) => a.id.localeCompare(b.id));
  },
  async findById(id) {
    if (prisma) {
      const device = await prisma.devices.findUnique({ where: { id } });
      return device ? { id: device.id, entityId: device.entity_id, name: device.name, type: device.type } : null;
    }
    return devices.find((device) => device.id === id) ?? null;
  },
});
