import crypto from "crypto";
import jwt from "jsonwebtoken";
import fs from "fs/promises";

export class FelicitySolarAPI {
    private JSON_FILE_PATH = "data/felicitySolarToken.json";

    private email: string;
    private passwordHash: string;

    private bearerToken: string | null = null;
    private tokenExpiration: Date | null = null;

    private devicesSerialNumbers: string[] = [];

    private publicKeyString =
        "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnAJE68pjWZmtSg6ZJs9FZugJXC6bBSluTW6mJttOLOaljrdErVnM5DNN+YFzpB9pAysTErjY1bnSVuEwQSwptnqUji7Ch2qMj2n+0eCp8p6vtSh7/tFr2ul8nDRtkoswLANAIwtUk/G85ipMpmY1W642LImnEJmGkkddlbjbjxJTZWR5hc/d9cPWb+AR77LxFFrMik3c+44v1kQlIPFP6EjIbOvt/Lv7fHWD9JI/YzN4y1gK7C/VQdNGuikQyNg+5W3rg9ecYf9I5uLAQwY/hxeI3lbNsErebqKe2EbJ8AwcNIC0lDBz53Sq0ML89QapEuy3fB+upuctxLULVDCbNwIDAQAB";
    private publicKey = `-----BEGIN PUBLIC KEY-----\n${this.publicKeyString}\n-----END PUBLIC KEY-----`;

    constructor(email: string, password: string) {
        this.email = email;
        this.passwordHash = this.generatePasswordHash(password);
    }

    public async initialize() {
        await this.loadFromFile();
        const loggedIn = await this.isLoggedIn();
        if (!loggedIn) {
            await this.login();
        }
        await this.loadDevicesSerialNumbers();
    }

    public async refreshDevices() {
        const loggedIn = await this.isLoggedIn();
        if (!loggedIn) {
            await this.login();
        }
        await this.loadDevicesSerialNumbers();
    }

    public getDevicesSerialNumbers(): string[] {
        return this.devicesSerialNumbers;
    }

    async getDeviceSnapshot(deviceSn: string): Promise<BatterySnapshot> {
        if (!this.isLoggedIn()) {
            throw new Error("Not logged in");
        }

        const todayDateStr = new Date().toISOString().slice(0, 19).replace("T", " ");

        const result = await fetch("https://shine-api.felicitysolar.com/device/get_device_snapshot", {
            headers: {
                accept: "application/json, text/plain, */*",
                authorization: this.bearerToken as string,
                "content-type": "application/json",
            },
            body: `{"deviceSn":"${deviceSn}","deviceType":"BP","dateStr":"${todayDateStr}"}`,
            method: "POST",
        });

        const data = await result.json();

        if ("data" in data === false) {
            throw new Error(`Failed to get device snapshot: ${JSON.stringify(data)}`);
        }
        const deviceData = data.data;
        if (!("productTypeEnum" in deviceData)) {
            throw new Error(`Invalid device data: ${JSON.stringify(deviceData)}`);
        }

        if (deviceData.productTypeEnum === "LITHIUM_BATTERY_PACK") {
            return data.data as BatterySnapshot;
        }

        throw new Error(`Unsupported device type: ${deviceData.productTypeEnum}`);
    }

    /*
     * Private methods
     */

    private async isLoggedIn(): Promise<boolean> {
        if (!this.bearerToken) return false;
        if (this.tokenExpiration === null) return false;
        return this.tokenExpiration! > new Date();
    }

    private async loadFromFile() {
        const fileExists = await fs.stat(this.JSON_FILE_PATH).catch(() => false);
        if (!fileExists) {
            return;
        }

        const data = await fs.readFile(this.JSON_FILE_PATH, "utf-8");
        try {
            const parsed = JSON.parse(data) as { email: string; bearer: string; exp: number }[];
            if (parsed.length === 0) return;

            const found = parsed.find((item) => item.email === this.email);
            if (!found) return;
            this.bearerToken = found.bearer;
            console.log("Loaded bearer token from file");
        } catch {
            console.error("Failed to parse felicitySolarToken.json");
        }
    }

    private async saveToFile() {
        if (!this.bearerToken || !this.tokenExpiration) {
            return;
        }

        let data: { email: string; bearer: string; exp: number }[] = [];
        const fileExists = await fs.stat(this.JSON_FILE_PATH).catch(() => false);

        if (!fileExists) {
            data.push({
                email: this.email,
                bearer: this.bearerToken,
                exp: this.tokenExpiration.getTime(),
            });
            await fs.writeFile(this.JSON_FILE_PATH, JSON.stringify(data));
            return;
        }

        const fileData = await fs.readFile(this.JSON_FILE_PATH, "utf-8");
        data = JSON.parse(fileData) as { email: string; bearer: string; exp: number }[];
        const found = data.find((item) => item.email === this.email);
        if (found && found.exp > Date.now()) {
            return;
        } else if (found) {
            found.bearer = this.bearerToken;
            found.exp = this.tokenExpiration.getTime();
            await fs.writeFile(this.JSON_FILE_PATH, JSON.stringify(data));
            return;
        }
        const newEntry = {
            email: this.email,
            bearer: this.bearerToken,
            exp: this.tokenExpiration.getTime(),
        };
        data.push(newEntry);
        await fs.writeFile(this.JSON_FILE_PATH, JSON.stringify(data));
    }

    private async loadDevicesSerialNumbers() {
        if (!this.isLoggedIn()) {
            throw new Error("Not logged in");
        }

        const result = await fetch("https://shine-api.felicitysolar.com/device/list_device_all_type", {
            headers: { accept: "application/json, text/plain, */*", authorization: this.bearerToken as string, "content-type": "application/json" },
            body: '{"pageNum":1,"pageSize":10,"deviceSn":"","status":"","sampleFlag":"","oscFlag":""}',
            method: "POST",
        });

        if (!result.ok) {
            throw new Error(`Failed to list devices: ${result.statusText}`);
        }

        const data = await result.json();
        const devicesSn = data.data.dataList.map((device: { deviceSn: string }) => device.deviceSn);

        this.devicesSerialNumbers = devicesSn;
    }

    private async login() {
        const result = await fetch("https://shine-api.felicitysolar.com/userlogin", {
            headers: { accept: "application/json, text/plain, */*", "content-type": "application/json" },
            body: `{"userName":"${this.email}","password":"${this.passwordHash}","version":"1.0"}`,
            method: "POST",
        });

        const data = await result.json();
        const bearer = data.data.token;

        const decryptedToken = jwt.decode(bearer.replace("Bearer_", ""));
        if (decryptedToken === null || typeof decryptedToken === "string" || !decryptedToken.exp) {
            throw new Error("Failed to decode token");
        }

        this.tokenExpiration = new Date(decryptedToken.exp * 1000);
        this.bearerToken = bearer;
        this.saveToFile();
    }

    private generatePasswordHash(password: string): string {
        const buffer = Buffer.from(password, "utf8");
        const encrypted = crypto.publicEncrypt({ key: this.publicKey, padding: crypto.constants.RSA_PKCS1_PADDING }, buffer);
        return encrypted.toString("base64");
    }
}

export type BatterySnapshot = {
    dataTime: number;
    dataTimeStr: string;
    pvPower: string;
    pv2Power: string;
    pv3Power: string;
    bmsPower: string;
    battSoc: string;
    battSoh: string;
    battCapacity: string;
    bmsState: string;
    bmsChargingState: number;
    battCurr: string;
    battVolt: string;
    totalEnergy: string;
    totalEnergyUnit: string;
    tempMax: string;
    tempMin: string;
    bmsFlag: boolean;
    emsVoltage: string;
    emsCurrent: string;
    seriesParallelStatus: number;
    maxCellTempNum: string;
    minBattTempNum: string;
    emsSoc: string;
    emsSoh: string;
    emsCapacity: string;
    totalEmsCapacity: string;
    maxVoltageNum2bms: string;
    maxVoltage2bms: string;
    minVoltageNum2bms: string;
    minVoltage2bms: string;
    bmsVoltageList: string[];
    cellTempList: string[];
    BMSLCVolt: string;
    BMSLDVolt: string;
    BMSLCCurr: string;
    BMSLDCurr: string;
    pv4Power: string;
    id: string;
    deviceSn: string;
    plantName: string;
    deviceModel: string;
    deviceType: string;
    status: string;
    ratedPower: string;
    collectorSn2: string;
    collectorVersion2: string;
    controlVersion: string;
    controlVersion2: string;
    iapVersion: string;
    firmwareVersion: string;
    batteryCapacity: string;
    activationFlag: boolean;
    energy: string;
    energyUnit: string;
    warningCount: number;
    timeZone: string;
    batHighVolFlag: boolean;
    type: string;
    subType: string;
    opTypeStr: string;
    parentId: string;
    electricityMeterLink: number;
    batTyStr: string;
    operMStr: string;
    operMHelpInfo: string;
    ronoffStr: string;
    isOwnerDevice: number;
    oSPriStr: string;
    cSPriStr: string;
    outModStr: string;
    hasMaster: number;
    hotJson: string;
    parStatusAnalysis: string;
    gunStateStr: string;
    standStr: string;
    electricityMeterLinkStr: string;
    batModStr: string;
    bmsFlagStr: string;
    bmsFlag2Str: string;
    cellVolt1: string;
    cellVolt2: string;
    cellVolt3: string;
    cellVolt4: string;
    cellVolt5: string;
    cellVolt6: string;
    cellVolt7: string;
    cellVolt8: string;
    cellVolt9: string;
    cellVolt10: string;
    cellVolt11: string;
    cellVolt12: string;
    cellVolt13: string;
    cellVolt14: string;
    cellVolt15: string;
    cellVolt16: string;
    cellTemp1: string;
    cellTemp2: string;
    cellTemp3: string;
    cellTemp4: string;
    batBmsOnlineStr: string;
    ctIsOnelineStr: string;
    wifiSignal: string;
    reportFreq: number;
    disPlayDataInfo: number;
    plantAuthorize: number;
    buttonAuthorityTag: string[];
    deviceDelete: number;
    slaveVersion: string;
    disPlayBatSetting: number;
    countryId: string;
    curr: string;
    volt: string;
    ratedEnergy: string;
    capacity: string;
    nameplateRatedPower: string;
    pvStatus1Str: string;
    pvStatus2Str: string;
    pvStatus3Str: string;
    pvStatus4Str: string;
    deviceClassConflict: boolean;
    hardwareVersion: string;
    cellNumber: string;
    productTypeEnum: string;
    batCount: number;
    batLineCount: number;
    bmslccurr: string;
    bmsldcurr: string;
    appMoStr: string;
    estoreStr: string;
    voltageLevel: number;
    inputPhaseNum: number;
    outputPhaseNum: number;
    pvChannelNum: number;
    standFlag: number;
    sampleFlag: number;
    grsmtr: number;
};
