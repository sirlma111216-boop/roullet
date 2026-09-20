/**
 * 항아리 탈출 (classic-jar)
 *
 * 이 파일은 tools/derive-classic-maps.mjs 가 만든다. 손으로 고치지 말고 그 스크립트를 고쳐라.
 * 원본: lazygyu/roulette (MIT) 커밋 47230e32242e1c82030eacb4a263420fe95cedb6 의 src/data/maps.ts — "Pot of greed"
 * 자세한 출처와 라이선스는 THIRD_PARTY_NOTICES.md 를 보라.
 */

import type { MapDefinition } from '../map/types.ts';

export const classicJar: MapDefinition = {
  id: "classic-jar",
  version: 1,
  name: "항아리 탈출",
  category: 'classic',
  description: "넓은 상부에서 큰 회전 발판들에 부딪히며 내려오다가, 항아리 바닥의 양쪽 통로 중 한쪽을 골라 중앙 출구로 빠져나간다.",
  highlights: ["넓은 상부","큰 회전 발판","하부 중앙 구조","양쪽 통로 분기"],
  origin: {"originalTitle":"Pot of greed","note":"넓은 상부와 하부 중앙 구조, 양쪽 통로와 회전 발판 배치를 계승했다."},
  bounds: {"x":0,"y":-20,"w":26,"h":120},
  preview: {"x":0,"y":-8,"w":26,"h":104},
  spawn: {"area":{"x":9.45,"y":-8,"w":7.1,"h":10},"perRow":10,"gap":0.62},
  finish: { area: {"x":0,"y":91,"w":26,"h":6} },
  checkpoints: [{"id":"cp1","name":"넓은 상부","area":{"x":0,"y":18,"w":26,"h":2}},{"id":"cp2","name":"회전 발판","area":{"x":0,"y":35,"w":26,"h":2}},{"id":"cp3","name":"항아리 허리","area":{"x":0,"y":55,"w":26,"h":2}},{"id":"cp4","name":"바닥 분기","area":{"x":0,"y":72,"w":26,"h":2}},{"id":"cp5","name":"중앙 출구","area":{"x":0,"y":86,"w":26,"h":2}}],
  estimatedDurationSec: [5,72],
  timeLimitSec: 150,
  progressPath: [
    [13,-18],
    [13,-5.75],
    [16.5,11.75],
    [11,38.25],
    [13,62],
    [13,70],
    [13,78],
    [13,84],
    [13,88],
    [13,93],
  ],
  obstacles: [
    {"t":"wall","points":[[17,-20],[9,-20],[9,8.5],[2,15],[6,61.5]],"style":"wall"},
    {"t":"wall","points":[[7,67.2],[9,85.2],[8,84.9],[6,84.6],[5,78.6],[4,66.6],[7,67.2]],"style":"wall"},
    {"t":"wall","points":[[17,-20],[17,8.5],[24,15],[20,61.5]],"style":"wall"},
    {"t":"wall","points":[[19,67.2],[17,85.2],[18,84.9],[20,84.6],[21,78.6],[22,66.6],[19,67.2]],"style":"wall"},
    {"t":"wall","points":[[11,77.4],[12,78.6],[12,91.8]],"style":"wall"},
    {"t":"wall","points":[[15,77.4],[14,78.6],[14,91.8]],"style":"wall"},
    {"t":"wall","points":[[12,85.8],[11,86.4],[9,87],[8,87],[6,86.4],[5,85.8],[4,84.6],[3,78.6],[2,66.6],[3,63.6],[4,62.4],[5,61.8],[6,61.5]],"style":"wall"},
    {"t":"wall","points":[[14,85.8],[15,86.4],[17,87],[18,87],[20,86.4],[21,85.8],[22,84.6],[23,78.6],[24,66.6],[23,63.6],[22,62.4],[21,61.8],[20,61.5]],"style":"wall"},
    {"t":"box","x":13,"y":20,"hw":3,"hh":3,"angle":0.785,"style":"box","restitution":0},
    {"t":"box","x":13,"y":55,"hw":3,"hh":3,"angle":0.785,"style":"box","restitution":0},
    {"t":"box","x":8,"y":37,"hw":2,"hh":2,"angle":0.785,"style":"box","restitution":0},
    {"t":"box","x":18,"y":37,"hw":2,"hh":2,"angle":0.785,"style":"box","restitution":0},
  ],
  devices: [
    {"t":"spinner","x":11,"y":12,"hw":2,"hh":0.1,"omega":-3,"angle":0,"style":"spinner"},
    {"t":"spinner","x":15,"y":12,"hw":2,"hh":0.1,"omega":3,"angle":0,"style":"spinner"},
    {"t":"spinner","x":8,"y":87,"hw":1,"hh":0.1,"omega":-10,"angle":0,"style":"spinner"},
    {"t":"spinner","x":6,"y":86.4,"hw":1.5,"hh":0.1,"omega":-10,"angle":0,"style":"spinner"},
    {"t":"spinner","x":4,"y":84.6,"hw":1.5,"hh":0.1,"omega":-10,"angle":0,"style":"spinner"},
    {"t":"spinner","x":3.5,"y":81.6,"hw":2,"hh":0.1,"omega":-10,"angle":0,"style":"spinner"},
    {"t":"spinner","x":3,"y":78.6,"hw":2,"hh":0.1,"omega":-10,"angle":0,"style":"spinner"},
    {"t":"spinner","x":2.75,"y":75.6,"hw":2,"hh":0.1,"omega":-10,"angle":0,"style":"spinner"},
    {"t":"spinner","x":2.5,"y":72.6,"hw":2,"hh":0.1,"omega":-10,"angle":0,"style":"spinner"},
    {"t":"spinner","x":2.25,"y":69.6,"hw":2,"hh":0.1,"omega":-10,"angle":0,"style":"spinner"},
    {"t":"spinner","x":2,"y":66.6,"hw":2,"hh":0.1,"omega":-10,"angle":0,"style":"spinner"},
    {"t":"spinner","x":18,"y":87,"hw":1,"hh":0.1,"omega":10,"angle":0,"style":"spinner"},
    {"t":"spinner","x":20,"y":86.4,"hw":1.5,"hh":0.1,"omega":10,"angle":0,"style":"spinner"},
    {"t":"spinner","x":22,"y":84.6,"hw":1.5,"hh":0.1,"omega":10,"angle":0,"style":"spinner"},
    {"t":"spinner","x":22.5,"y":81.6,"hw":2,"hh":0.1,"omega":10,"angle":0,"style":"spinner"},
    {"t":"spinner","x":23,"y":78.6,"hw":2,"hh":0.1,"omega":10,"angle":0,"style":"spinner"},
    {"t":"spinner","x":23.25,"y":75.6,"hw":2,"hh":0.1,"omega":10,"angle":0,"style":"spinner"},
    {"t":"spinner","x":23.5,"y":72.6,"hw":2,"hh":0.1,"omega":10,"angle":0,"style":"spinner"},
    {"t":"spinner","x":23.75,"y":69.6,"hw":2,"hh":0.1,"omega":10,"angle":0,"style":"spinner"},
    {"t":"spinner","x":24,"y":66.6,"hw":2,"hh":0.1,"omega":10,"angle":0,"style":"spinner"},
  ],
};
