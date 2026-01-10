import { FelicitySolarAPI } from "./FelicitySolarAPI";

export class FelicityWorker {
    private devicesData: DeviceData<any>[] = [];
    private api: FelicitySolarAPI;
    private updateTask: NodeJS.Timeout | null = null;

    constructor(api: FelicitySolarAPI, updateIntervalMs: number = 30_000) {
        this.api = api;
        this.startPeriodicUpdate(updateIntervalMs);
    }

    public startPeriodicUpdate(intervalMs: number) {
        this.fetchDevicesInfo(); // Initial fetch
        if (this.updateTask) clearInterval(this.updateTask);
        this.updateTask = setInterval(() => this.fetchDevicesInfo(), intervalMs);
    }

    public stopPeriodicUpdate() {
        if (this.updateTask) {
            clearInterval(this.updateTask);
            this.updateTask = null;
        }
    }

    public getDevicesData() {
        return this.devicesData;
    }

    private async fetchDevicesInfo() {
        for (const deviceSn of this.api.getDevicesSerialNumbers()) {
            const snapshot = await this.api.getDeviceSnapshot(deviceSn);
            const batteryData = {
                type: snapshot.productTypeEnum,
                serialNumber: deviceSn,
                data: {
                    battery: {
                        voltage: parseFloat(snapshot.battVolt),
                        current: parseFloat(snapshot.battCurr),
                        soc: parseInt(snapshot.battSoc),
                        soh: parseInt(snapshot.battSoh),
                        ratedEnergy: parseFloat(snapshot.ratedEnergy),
                        energyUnit: snapshot.energyUnit,
                        nameplateRatedPower: snapshot.nameplateRatedPower,
                    },
                    ems: {
                        voltage: parseFloat(snapshot.emsVoltage),
                        current: parseFloat(snapshot.emsCurrent),
                        soc: parseInt(snapshot.emsSoc),
                        soh: parseInt(snapshot.emsSoh),
                    },
                },
            } satisfies DeviceData<BatteryData>;

            // Update or add the device data
            const found = this.devicesData.find((d) => d.serialNumber === deviceSn);
            if (found) {
                Object.assign(found, batteryData);
                continue;
            }

            this.devicesData.push(batteryData);
        }
    }
}

interface DeviceData<T> {
    type: string;
    serialNumber: string;
    data: T;
}

type BatteryData = {
    battery: {
        voltage: number;
        current: number;
        soc: number;
        soh: number;
        ratedEnergy: number;
        energyUnit: string;
        nameplateRatedPower: string;
    };
    ems: {
        voltage: number;
        current: number;
        soc: number;
        soh: number;
    };
};
