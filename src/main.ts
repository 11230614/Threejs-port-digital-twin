// ============================================================================
// main.ts —— 应用入口（Entry Point：整个前端从这里开始跑）
//
// 【这个文件干什么】
// Vite 打包后浏览器第一个执行的就是它。只做三件事：
//   1) 创建 Vue 应用实例；
//   2) 装上 Pinia（状态管理插件），让所有组件都能读写共享状态；
//   3) 把应用挂载到 index.html 里那个 id 为 app 的 div 上。
//
// 【术语翻译】
//   createApp（创建应用实例，Vue 3 的入口 API）
//   Pinia（Vue 官方推荐的状态管理库，替代 Vuex）
//   createPinia（创建 Pinia 状态管理实例）
//   plugin（插件）              use（安装插件）
//   mount（挂载，把 Vue 组件树接到真实 DOM 节点上）
//   DOM（Document Object Model，文档对象模型，即网页元素树）
//   SFC（Single File Component，单文件组件，即 .vue 文件）
// ============================================================================

import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./style.css";

const app = createApp(App);
app.use(createPinia());
app.mount("#app");
