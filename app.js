// Radar BLE 프로비저닝 — Web Bluetooth + UI + postMessage.
// RADAR_BLE_PROVISIONING_WEB.md §5. 순수 프로토콜은 provision-protocol.js.

import {
    SERVICE_UUID, CHAR, STATE, buildSendProvisionCmd, parseResult, verifyChecksum,
    macFromDeviceName, errorMessage,
} from "./provision-protocol.js";

const $ = (id) => document.getElementById(id);

const ui = {
    connectBtn: $("connectBtn"), disconnectBtn: $("disconnectBtn"), connStatus: $("connStatus"),
    ssid: $("ssid"), pw: $("pw"), pwToggle: $("pwToggle"), server: $("server"), sendBtn: $("sendBtn"),
    savePw: $("savePw"),
    steps: $("steps"), okBox: $("okBox"), errBox: $("errBox"), logbox: $("logbox"),
    unsupported: $("unsupported"),
};

// ── 입력값 기억 (localStorage) ───────────────────────────────────────────────
// SSID·서버는 항상 저장. 비밀번호는 "이 기기에 저장" 체크 시에만 저장(평문).
const LS = { ssid: "rp.ssid", server: "rp.server", pw: "rp.pw", savePw: "rp.savePw" };

function loadSaved()
{
    try
    {
        const s = localStorage.getItem(LS.ssid); if (s !== null) ui.ssid.value = s;
        const sv = localStorage.getItem(LS.server); if (sv !== null) ui.server.value = sv;
        if (localStorage.getItem(LS.savePw) === "1")
        {
            ui.savePw.checked = true;
            const p = localStorage.getItem(LS.pw); if (p !== null) ui.pw.value = p;
        }
    }
    catch { /* localStorage 불가 환경 무시 */ }
}

function persist()
{
    try
    {
        localStorage.setItem(LS.ssid, ui.ssid.value);
        localStorage.setItem(LS.server, ui.server.value);
        if (ui.savePw.checked)
        {
            localStorage.setItem(LS.savePw, "1");
            localStorage.setItem(LS.pw, ui.pw.value);
        }
        else
        {
            localStorage.setItem(LS.savePw, "0");
            localStorage.removeItem(LS.pw);
        }
    }
    catch { /* 저장 실패 무시 */ }
}

// ── 상태 ────────────────────────────────────────────────────────────────────
let device = null;
let chars = null;          // { state, error, command, result }
let deviceMac = "";
let provisionedIp = "";
let serverAddrSent = "";

// ── 로그 (암호는 절대 기록 금지) ─────────────────────────────────────────────
function log(msg)
{
    const t = new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date());
    ui.logbox.textContent += `[${t}] ${msg}\n`;
    ui.logbox.scrollTop = ui.logbox.scrollHeight;
}

function setStep(step)
{
    const order = ["idle", "provisioning", "provisioned"];
    const idx = order.indexOf(step);
    ui.steps.querySelectorAll("li").forEach((li) =>
    {
        const i = order.indexOf(li.dataset.step);
        li.classList.toggle("done", i < idx);
        li.classList.toggle("active", i === idx);
    });
}

function showError(msg)
{
    ui.errBox.textContent = "⚠ " + msg;
    ui.errBox.classList.remove("hidden");
    ui.sendBtn.disabled = false;
    ui.sendBtn.textContent = "다시 시도";
}

function clearBoxes()
{
    ui.okBox.classList.add("hidden");
    ui.errBox.classList.add("hidden");
}

function setFormEnabled(on)
{
    ui.ssid.disabled = !on; ui.pw.disabled = !on; ui.pwToggle.disabled = !on;
    ui.server.disabled = !on; ui.sendBtn.disabled = !on; ui.savePw.disabled = !on;
}

// ── 연결 ────────────────────────────────────────────────────────────────────
async function connect()
{
    clearBoxes();
    try
    {
        log("BLE 장비 검색...");
        device = await navigator.bluetooth.requestDevice({
            filters: [{ namePrefix: "radar_" }],
            optionalServices: [SERVICE_UUID],
        });
        deviceMac = macFromDeviceName(device.name || "");
        device.addEventListener("gattserverdisconnected", onDisconnected);

        log(`연결 중: ${device.name}`);
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(SERVICE_UUID);
        chars = {
            state: await service.getCharacteristic(CHAR.state),
            error: await service.getCharacteristic(CHAR.error),
            command: await service.getCharacteristic(CHAR.command),
            result: await service.getCharacteristic(CHAR.result),
        };

        await chars.state.startNotifications();
        chars.state.addEventListener("characteristicvaluechanged", onStateChanged);
        await chars.error.startNotifications();
        chars.error.addEventListener("characteristicvaluechanged", onErrorChanged);
        await chars.result.startNotifications();
        chars.result.addEventListener("characteristicvaluechanged", onResultChanged);

        ui.connStatus.textContent = `상태: 연결됨 (${device.name})`;
        ui.connStatus.classList.remove("muted");
        ui.connectBtn.classList.add("hidden");
        ui.disconnectBtn.classList.remove("hidden");
        setFormEnabled(true);
        setStep("idle");
        log(`BLE 연결 완료: ${device.name}`);
    }
    catch (e)
    {
        if (e && e.name === "NotFoundError") { log("장비 선택 취소됨"); return; }
        log("연결 실패: " + (e && e.message ? e.message : e));
        showError("BLE 연결 실패: " + (e && e.message ? e.message : e));
    }
}

function onDisconnected()
{
    log("BLE 연결 해제됨");
    ui.connStatus.textContent = "상태: 미연결";
    ui.connStatus.classList.add("muted");
    ui.connectBtn.classList.remove("hidden");
    ui.disconnectBtn.classList.add("hidden");
    setFormEnabled(false);
    chars = null;
}

function disconnect()
{
    try { if (device && device.gatt.connected) device.gatt.disconnect(); }
    catch { /* ignore */ }
}

// ── Notify 핸들러 ────────────────────────────────────────────────────────────
function onStateChanged(e)
{
    const s = e.target.value.getUint8(0);
    log(`상태 알림: 0x${s.toString(16).padStart(2, "0")}`);
    if (s === STATE.PROVISIONING) setStep("provisioning");
    else if (s === STATE.PROVISIONED)
    {
        setStep("provisioned");
        onProvisioned();
    }
}

function onErrorChanged(e)
{
    const code = e.target.value.getUint8(0);
    const msg = errorMessage(code);
    if (msg)
    {
        log(`에러 알림: 0x${code.toString(16).padStart(2, "0")} — ${msg}`);
        showError(msg);
    }
}

function onResultChanged(e)
{
    const dv = e.target.value;
    if (!verifyChecksum(dv)) { log("결과 패킷 체크섬 불일치 — 무시"); return; }
    try
    {
        const r = parseResult(dv);
        provisionedIp = r.url;
        log(`결과 수신: IP/상태 = ${r.url}`);
    }
    catch (err) { log("결과 파싱 실패: " + err.message); }
}

function onProvisioned()
{
    clearBoxes();
    ui.okBox.textContent = `✓ 완료. 장비가 자동 재부팅됩니다${provisionedIp ? ` (IP: ${provisionedIp})` : ""}.`;
    ui.okBox.classList.remove("hidden");
    ui.sendBtn.disabled = true;
    log("프로비저닝 완료");
    notifyOpener();
    // 결과 확인 시간을 준 뒤 자동 닫기 (사용자가 미리 닫아도 무방)
    setTimeout(() => { try { window.close(); } catch { /* ignore */ } }, 4000);
}

// ── 전송 ────────────────────────────────────────────────────────────────────
async function send()
{
    clearBoxes();
    const ssid = ui.ssid.value.trim();
    const pw = ui.pw.value;
    const server = ui.server.value.trim();

    if (new TextEncoder().encode(ssid).length < 1 || new TextEncoder().encode(ssid).length > 32)
    { showError("SSID 는 1~32바이트여야 합니다."); return; }
    if (pw.length < 8 || pw.length > 63)
    { showError("WiFi 암호는 8~63자여야 합니다 (WPA2)."); return; }
    if (server.length < 1 || server.length > 64)
    { showError("서버 주소는 1~64자여야 합니다."); return; }

    if (!window.confirm("이 정보로 장비를 설정하시겠습니까?\n\nSSID: " + ssid + "\n서버: " + server)) return;
    if (!chars) { showError("장비가 연결되지 않았습니다."); return; }

    try
    {
        serverAddrSent = server;
        const pkt = buildSendProvisionCmd(ssid, pw, server);
        log(`전송: SSID=${ssid}, 서버=${server} (암호 ${pw.length}자)`);  // 암호 값은 기록 안 함
        ui.sendBtn.disabled = true;
        ui.sendBtn.textContent = "전송 중...";
        setStep("provisioning");
        await chars.command.writeValue(pkt);
        log("전송 완료 — 장비 응답 대기");
    }
    catch (e)
    {
        log("전송 실패: " + (e && e.message ? e.message : e));
        showError("전송 실패: " + (e && e.message ? e.message : e));
        ui.sendBtn.textContent = "다시 시도";
    }
}

// ── opener(관리자 페이지) 로 결과 회신 ───────────────────────────────────────
function notifyOpener()
{
    if (!window.opener) return;  // 직접 URL 접근 시 opener 없음 — 무시
    let targetOrigin = "*";
    try { if (document.referrer) targetOrigin = new URL(document.referrer).origin; }
    catch { /* referrer 없음 → '*' */ }
    window.opener.postMessage({
        type: "provision-complete",
        result: { mac: deviceMac, ip: provisionedIp || "ok", server: serverAddrSent },
    }, targetOrigin);
    log("관리자 페이지로 완료 통지 전송");
}

// ── 부트스트랩 ───────────────────────────────────────────────────────────────
function init()
{
    if (!(navigator.bluetooth && navigator.bluetooth.requestDevice))
    {
        ui.unsupported.classList.remove("hidden");
        ui.connectBtn.disabled = true;
        return;
    }
    ui.connectBtn.addEventListener("click", connect);
    ui.disconnectBtn.addEventListener("click", disconnect);
    ui.sendBtn.addEventListener("click", send);
    ui.pwToggle.addEventListener("click", () =>
    {
        const show = ui.pw.type === "password";
        ui.pw.type = show ? "text" : "password";
        ui.pwToggle.textContent = show ? "숨김" : "표시";
    });

    // 입력값 기억 — 저장된 값 복원 + 변경 시 저장.
    loadSaved();
    ui.ssid.addEventListener("input", persist);
    ui.server.addEventListener("input", persist);
    ui.pw.addEventListener("input", persist);
    ui.savePw.addEventListener("change", persist);

    setStep("idle");
}

init();
