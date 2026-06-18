// node:test 단위 테스트 — 의존성 0. 실행: npm test  (또는 node --test)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
    buildSendProvisionCmd, parseResult, verifyChecksum, macFromDeviceName, errorMessage,
} from "./provision-protocol.js";

test("buildSendProvisionCmd — 바이트 시퀀스 + 체크섬", () =>
{
    const pkt = buildSendProvisionCmd("wifi", "pass1234", "192.168.1.1");
    // cmd_id
    assert.equal(pkt[0], 0x01);
    // data = [4]wifi[8]pass1234[11]192.168.1.1
    const dataLen = 1 + 4 + 1 + 8 + 1 + 11; // 26
    assert.equal(pkt[1], dataLen);
    assert.equal(pkt.length, 2 + dataLen + 1);
    // 필드 길이 prefix 확인
    assert.equal(pkt[2], 4);                 // ssid_len
    assert.equal(pkt[2 + 1 + 4], 8);         // pw_len
    assert.equal(pkt[2 + 1 + 4 + 1 + 8], 11); // server_len
    // 체크섬 = (cmd_id + data_len + Σdata) & 0xFF
    let sum = 0x01 + dataLen;
    for (let i = 2; i < 2 + dataLen; i++) sum += pkt[i];
    assert.equal(pkt[pkt.length - 1], sum & 0xFF);
});

test("buildSendProvisionCmd — UTF-8 한글 SSID 바이트 길이", () =>
{
    const pkt = buildSendProvisionCmd("사무실", "pass1234", "host");
    // "사무실" = 9 bytes (UTF-8, 3byte×3)
    assert.equal(pkt[2], 9);
});

test("parseResult — IP 추출", () =>
{
    // [cmd_id=01][data_len][url_len][url...][checksum]
    const url = "192.168.1.42";
    const urlBytes = new TextEncoder().encode(url);
    const bytes = new Uint8Array(3 + urlBytes.length + 1);
    bytes[0] = 0x01;
    bytes[1] = 1 + urlBytes.length;     // data_len = url_len(1) + url
    bytes[2] = urlBytes.length;         // url_len
    bytes.set(urlBytes, 3);
    // checksum
    let sum = 0;
    for (let i = 0; i < bytes.length - 1; i++) sum += bytes[i];
    bytes[bytes.length - 1] = sum & 0xFF;

    const dv = new DataView(bytes.buffer);
    const r = parseResult(dv);
    assert.equal(r.cmdId, 0x01);
    assert.equal(r.url, "192.168.1.42");
    assert.equal(verifyChecksum(dv), true);
});

test("verifyChecksum — 변조 시 false", () =>
{
    const bytes = new Uint8Array([0x01, 0x02, 0x6F, 0x6B, 0x00]); // 마지막 체크섬 일부러 틀림
    const dv = new DataView(bytes.buffer);
    assert.equal(verifyChecksum(dv), false);
});

test("macFromDeviceName", () =>
{
    assert.equal(macFromDeviceName("radar_AABBCC"), "AABBCC");
    assert.equal(macFromDeviceName("other"), "other");
    assert.equal(macFromDeviceName(undefined), "");
});

test("errorMessage", () =>
{
    assert.equal(errorMessage(0x00), null);
    assert.equal(errorMessage(0x04), "WiFi 암호 불일치");
    assert.ok(errorMessage(0x99).includes("알 수 없는 오류"));
});
