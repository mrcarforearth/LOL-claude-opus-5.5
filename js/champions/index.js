// 英雄注册表：CHAMPIONS（id → 定义）与 CHAMPION_LIST（按选人界面顺序）
import garen from './garen.js';
import darius from './darius.js';
import leesin from './leesin.js';
import masteryi from './masteryi.js';
import ahri from './ahri.js';
import lux from './lux.js';
import annie from './annie.js';
import ashe from './ashe.js';
import jinx from './jinx.js';
import thresh from './thresh.js';
import yasuo from './yasuo.js';
import ezreal from './ezreal.js';
import malphite from './malphite.js';
import zed from './zed.js';
import morgana from './morgana.js';
import xinzhao from './xinzhao.js';

export const CHAMPION_LIST = [garen, darius, leesin, masteryi, ahri, lux, annie, ashe, jinx, thresh, yasuo, ezreal, malphite, zed, morgana, xinzhao];
export const CHAMPIONS = Object.fromEntries(CHAMPION_LIST.map((c) => [c.id, c]));
export default CHAMPIONS;
