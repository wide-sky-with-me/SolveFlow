import { parentPort, workerData } from "node:worker_threads";
parentPort.postMessage({ length: workerData.image.byteLength, first: workerData.image[0], last: workerData.image.at(-1), metadata: workerData.input });
