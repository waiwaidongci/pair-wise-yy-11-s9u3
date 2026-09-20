import { buildSeed } from "../domain/seed";
import { loadState, saveState } from "../storage/persistence";
import { createStore } from "./createStore";

// 应用唯一状态源：启动时从存储层恢复，否则写入演示数据
export const store = createStore(loadState() ?? buildSeed(new Date()), saveState);
