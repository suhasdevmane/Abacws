import { useAPI, useAPISubscription } from "./useAPI";

export function useDevices() {
  return useAPI("/api/devices")?.body;
}

export function useDeviceInfo(deviceName) {
  const url = deviceName ? `/api/devices/${deviceName}` : undefined;
  return useAPI(url)?.body;
}

export function useDeviceData(deviceName) {
  const url = deviceName ? `/api/devices/${deviceName}/data` : undefined;
  return useAPISubscription(url)?.body;
}

export function useDeviceHistory(deviceName) {
  const to = Math.round(Date.now()/20000)*20000;
  const from = to - (12*60*60*1000);
  const url = deviceName ? `/api/devices/${deviceName}/history?to=${to}&from=${from}` : undefined;
  return useAPISubscription(url)?.body;
}
