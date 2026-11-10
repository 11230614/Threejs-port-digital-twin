/** Business configuration only. Disabled scans pause their phase until re-enabled. */
export class AgvRadarComponent {
  enabled = false;
  /** Radius in world scene units (the port uses metres). */
  radius = 18;
  /** Signed angular velocity in radians/second, independent of vehicle speed. */
  angularSpeed = 1.4;
  constructor(options: Partial<AgvRadarComponent> = {}) { Object.assign(this, options); }
}
