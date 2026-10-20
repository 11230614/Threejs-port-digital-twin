import type { SceneEntity } from "../stores/types";

interface UISystemSelection {
  getSelected(): SceneEntity | null;
}

interface UISystemStats {
  assets: number;
  cranes: number;
  agvs: number;
  yards: number;
  containers: number;
}

export interface UISystemOptions {
  mount: HTMLElement;
  selectionSystem: UISystemSelection;
  stats: UISystemStats;
  onToggleCruise: (enabled: boolean) => void;
}

export class UISystem {
  readonly mount: HTMLElement;
  readonly selectionSystem: UISystemSelection;
  readonly stats: UISystemStats;
  readonly onToggleCruise: (enabled: boolean) => void;
  readonly root: HTMLElement;
  private readonly cruiseButton: HTMLButtonElement;
  private readonly cruiseClickHandler: () => void;
  cruising = false;

  constructor({ mount, selectionSystem, stats, onToggleCruise }: UISystemOptions) {
    this.mount = mount;
    this.selectionSystem = selectionSystem;
    this.stats = stats;
    this.onToggleCruise = onToggleCruise;
    this.root = this._createRoot(stats);
    const button = this.root.querySelector("button");
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error("UISystem cruise button was not created.");
    }
    this.cruiseButton = button;
    this.cruiseClickHandler = () => {
      this.cruising = !this.cruising;
      this.onToggleCruise(this.cruising);
      this.cruiseButton.textContent = this.cruising ? "停止自动巡航" : "启动自动巡航";
      this.cruiseButton.classList.toggle("is-active", this.cruising);
    };
    this.cruiseButton.addEventListener("click", this.cruiseClickHandler);
    this.mount.appendChild(this.root);
  }

  update(): void {
    const selected = this.selectionSystem.getSelected();
    const asset = selected?.asset ?? null;
    const title = this.root.querySelector<HTMLElement>("[data-selected-title]");
    const speed = this.root.querySelector<HTMLElement>("[data-selected-speed]");
    const position = this.root.querySelector<HTMLElement>("[data-selected-position]");

    if (!selected || !asset) {
      if (!title || !speed || !position) throw new Error("UISystem selection display is incomplete.");
      title.textContent = "未选中资产";
      speed.textContent = "状态: --";
      position.textContent = "位置: --";
      return;
    }

    if (!title || !speed || !position) throw new Error("UISystem selection display is incomplete.");
    title.textContent = `${asset.number} / ${asset.area}`;
    const motion = selected.motion;
    if (motion) {
      if (typeof motion.speed !== "number") throw new Error("Selected scene entity has no numeric motion speed.");
      speed.textContent = `速度: ${motion.speed.toFixed(1)} m/s`;
    } else {
      speed.textContent = `状态: ${asset.currentTask}`;
    }

    const worldPosition = selected.getWorldPosition();
    if (!worldPosition) throw new Error("Selected scene entity has no world position.");
    position.textContent = `位置: ${worldPosition.x.toFixed(1)}, ${worldPosition.y.toFixed(1)}, ${worldPosition.z.toFixed(1)}`;
  }

  destroy(): void {
    this.cruiseButton.removeEventListener("click", this.cruiseClickHandler);
    this.root.remove();
  }

  private _createRoot(stats: UISystemStats): HTMLElement {
    const root = document.createElement("section");
    root.className = "dock-ui";
    root.innerHTML = `
      <div class="dock-ui__title">智慧码头数字孪生</div>
      <dl class="dock-ui__stats">
        <div><dt>资产总数</dt><dd>${stats.assets}</dd></div>
        <div><dt>岸桥 QC</dt><dd>${stats.cranes}</dd></div>
        <div><dt>AGV 车辆</dt><dd>${stats.agvs}</dd></div>
        <div><dt>堆场区域</dt><dd>${stats.yards}</dd></div>
      </dl>
      <button class="dock-ui__button" type="button">启动自动巡航</button>
      <div class="dock-ui__selection">
        <strong data-selected-title>未选中资产</strong>
        <span data-selected-speed>状态: --</span>
        <span data-selected-position>位置: --</span>
      </div>

    `;
    return root;
  }
}
