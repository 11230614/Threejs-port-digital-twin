// Explicit static demo registry. These IDs mirror PortEquipmentBuilder's
// current five-AGV construction rule without importing browser/Three.js code.
export const devices = Object.freeze(
  Array.from({ length: 5 }, (_, index) => Object.freeze({
    id: `AGV-${String(index + 1).padStart(2, "0")}`,
    entityId: `AGV_${String(index + 1).padStart(2, "0")}`,
    name: `AGV ${String(index + 1).padStart(2, "0")}`,
    type: "agv",
  })),
);

const ids = new Set();
const entityIds = new Set();
for (const device of devices) {
  if (ids.has(device.id)) throw new Error(`Duplicate device id: ${device.id}`);
  if (entityIds.has(device.entityId)) throw new Error(`Duplicate entityId: ${device.entityId}`);
  ids.add(device.id);
  entityIds.add(device.entityId);
}
