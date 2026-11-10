export interface SimulatedAlarmState {
  battery: number;
  onlineStatus: "online" | "offline";
  simulated: true;
  simulationScenario: "normal" | "low-battery" | "offline";
}

/** Hold each sample for 8 seconds, then recover for 4 seconds before redrawing. */
export class SimulatedAlarm {
  private readonly states = new Map<string, { cycle: number; state: SimulatedAlarmState }>();

  sample(id: string, elapsedMs: number, random: () => number = Math.random): SimulatedAlarmState {
    const cycle = Math.floor(elapsedMs / 12000);
    let entry = this.states.get(id);
    if (!entry || entry.cycle !== cycle) {
      const choice = random();
      const scenario = choice < 0.25 ? "offline" : choice < 0.65 ? "low-battery" : "normal";
      entry = { cycle, state: { battery: scenario === "low-battery" ? (random() < 0.5 ? 12 : 22) : 80,
        onlineStatus: scenario === "offline" ? "offline" : "online", simulated: true, simulationScenario: scenario } };
      this.states.set(id, entry);
    }
    if (elapsedMs % 12000 >= 8000) return { battery: 80, onlineStatus: "online", simulated: true, simulationScenario: "normal" };
    return { ...entry.state };
  }
}
