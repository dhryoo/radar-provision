// Radar BLE 프로비저닝 — 프로토콜 순수 함수 (브라우저/Node 공용, 의존성 0).
// RADAR_BLE_PROVISIONING_WEB.md §4 BLE GATT 프로토콜 기준.
// app.js(브라우저) 와 provision-protocol.test.js(node:test) 가 공유.

export const SERVICE_UUID = "f6ad0001-9b8d-4e3a-bce5-7c2f9a4d1e80";
export const CHAR = {
    capabilities: "f6ad0002-9b8d-4e3a-bce5-7c2f9a4d1e80",
    state:        "f6ad0003-9b8d-4e3a-bce5-7c2f9a4d1e80",
    error:        "f6ad0004-9b8d-4e3a-bce5-7c2f9a4d1e80",
    command:      "f6ad0005-9b8d-4e3a-bce5-7c2f9a4d1e80",
    result:       "f6ad0006-9b8d-4e3a-bce5-7c2f9a4d1e80",
};

// Current State enum
export const STATE = { AUTHORIZED: 0x02, PROVISIONING: 0x03, PROVISIONED: 0x04 };
export const STATE_LABEL = {
    [STATE.AUTHORIZED]: "연결됨 (대기)",
    [STATE.PROVISIONING]: "자격증명 전송 — WiFi 연결 시도 중",
    [STATE.PROVISIONED]: "저장 완료 — 장비 재부팅",
};

// Error enum → 한국어 메시지 (§4.4)
export const ERROR_MESSAGE = {
    0x00: null, // NoError
    0x01: "패킷 형식 오류 (페이지 버그 가능)",
    0x02: "지원되지 않는 명령",
    0x03: "WiFi 연결 실패 — SSID 확인",
    0x04: "WiFi 암호 불일치",
    0x05: "WiFi 연결됨, 서버 도달 불가 — 서버 주소 확인",
    0xFF: "알 수 없는 오류",
};
export function errorMessage(code)
{
    if (code === 0x00) return null;
    return ERROR_MESSAGE[code] ?? `알 수 없는 오류 (0x${code.toString(16)})`;
}

const CMD_SEND_PROVISION = 0x01;

/**
 * SendProvisionSettings(0x01) RPC 패킷 생성.
 * packet = [cmd_id][data_len][data][checksum]
 *   data = [ssid_len][ssid][pw_len][pw][server_len][server]  (UTF-8)
 *   checksum = (cmd_id + data_len + Σdata) & 0xFF
 * @returns {Uint8Array}
 */
export function buildSendProvisionCmd(ssid, pw, server)
{
    const enc = new TextEncoder();
    const ssidB = enc.encode(ssid);
    const pwB = enc.encode(pw);
    const srvB = enc.encode(server);
    if (ssidB.length > 255 || pwB.length > 255 || srvB.length > 255)
    {
        throw new Error("필드 길이 초과");
    }

    const data = new Uint8Array(3 + ssidB.length + pwB.length + srvB.length);
    let p = 0;
    data[p++] = ssidB.length; data.set(ssidB, p); p += ssidB.length;
    data[p++] = pwB.length;   data.set(pwB, p);   p += pwB.length;
    data[p++] = srvB.length;  data.set(srvB, p);  p += srvB.length;

    const dataLen = data.length;
    const pkt = new Uint8Array(2 + dataLen + 1);
    pkt[0] = CMD_SEND_PROVISION;
    pkt[1] = dataLen;
    pkt.set(data, 2);
    let sum = CMD_SEND_PROVISION + dataLen;
    for (const b of data) sum += b;
    pkt[2 + dataLen] = sum & 0xFF;
    return pkt;
}

/**
 * RPC Result 패킷 파싱.
 * [cmd_id][data_len][url_len][url(UTF-8)][checksum]
 * @param {DataView} dataView
 * @returns {{cmdId:number, url:string}}
 */
export function parseResult(dataView)
{
    const cmdId = dataView.getUint8(0);
    // dataView.getUint8(1) = data_len (검증은 verifyChecksum 으로)
    const urlLen = dataView.getUint8(2);
    const urlBytes = new Uint8Array(dataView.buffer, dataView.byteOffset + 3, urlLen);
    const url = new TextDecoder().decode(urlBytes);
    return { cmdId, url };
}

/**
 * 수신 패킷 체크섬 검증 — 마지막 바이트 = (앞 전체 바이트 합) & 0xFF.
 * @param {DataView} dataView
 * @returns {boolean}
 */
export function verifyChecksum(dataView)
{
    const total = dataView.byteLength;
    if (total < 1) return false;
    let sum = 0;
    for (let i = 0; i < total - 1; i++) sum += dataView.getUint8(i);
    return (sum & 0xFF) === dataView.getUint8(total - 1);
}

/** BLE 디바이스 이름(radar_AABBCC) → MAC 힌트(AABBCC). prefix 없으면 원본 반환. */
export function macFromDeviceName(name)
{
    if (typeof name !== "string") return "";
    return name.startsWith("radar_") ? name.slice("radar_".length) : name;
}
