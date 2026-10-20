import { DiscoveryService } from './src/services/discovery.js';
import { ControlService } from './src/services/control.js';
import tuDeviceImage from './src/assets/TUSeries.png';
import vxDeviceImage from './src/assets/VXSeries.png';
import hDeviceImage from './src/assets/HSeries.png';

// Set embedded device images
const _tuImg = document.getElementById('deviceImgTu');
if (_tuImg) _tuImg.src = tuDeviceImage;

const _vxImg = document.getElementById('deviceImgVx');
if (_vxImg) _vxImg.src = vxDeviceImage;

const _hImg = document.getElementById('deviceImgH');
if (_hImg) _hImg.src = hDeviceImage;

console.log('[LEDECA] Uygulama başlatılıyor...');

// Uygulama Durumu
const state = {
    devices: JSON.parse(localStorage.getItem('ledeca_found_devices') || '[]'),
    isConnected: false,
    activeDevice: null,
    currentPage: 'discovery',
    presetNames: JSON.parse(localStorage.getItem('ledeca_preset_names') || '{}'),
    isBlackoutActive: false,
    isFreezeActive: false
};

let tuStatusInterval = null; // TU cihazları için durum sordulama aralığı
let isUserInteractingWithVolume = false;

// DOM Öğeleri
const btnScan = document.getElementById('btnScan');
const btnManualScan = document.getElementById('btnManualScan');
const manualIpInput = document.getElementById('manualIp');
const seriesSelect = document.getElementById('seriesSelect');
const deviceList = document.getElementById('deviceList');
const connectionStatus = document.getElementById('connectionStatus');
const activeDeviceInfo = document.getElementById('activeDeviceInfo');
const connectedDeviceName = document.getElementById('connectedDeviceName');
const btnDisconnect = document.getElementById('btnDisconnect');
const controlPanel = document.getElementById('controlPanel');
const brightnessSlider = document.getElementById('brightnessSlider');
const brightnessValue = document.getElementById('brightnessValue');
const connectedDeviceSubtitle = document.getElementById('connectedDeviceSubtitle');

// Progress UI
const scanProgressContainer = document.getElementById('scanProgressContainer');
const scanStatusText = document.getElementById('scanStatusText');
const scanPercentage = document.getElementById('scanPercentage');
const scanProgressBar = document.getElementById('scanProgressBar');

// Alt Sayfa Öğeleri
const cardBrightness = document.getElementById('cardBrightness');
const cardPresets = document.getElementById('cardPresets');
const cardBlackout = document.getElementById('cardBlackout');
const cardFreeze = document.getElementById('cardFreeze');
const controlHome = document.getElementById('control-home');
const controlDetailBrightness = document.getElementById('control-detail-brightness');
const controlDetailPresets = document.getElementById('control-detail-vx-presets');
const btnBackToControl = document.getElementById('btnBackToControl');
const btnBackToControlFromPresets = document.getElementById('btnBackToControlFromPresets');

// Cihaz Sayfası Öğeleri
const infoDeviceIp = document.getElementById('infoDeviceIp');
const infoDeviceStatus = document.getElementById('infoDeviceStatus');
const infoDeviceName = document.getElementById('infoDeviceName');
const fanList = document.getElementById('fanList');
const btnRefreshFan = document.getElementById('btnRefreshFan');
const cardEthernet = document.getElementById('cardEthernet');
const controlDetailEthernet = document.getElementById('control-detail-ethernet');
const btnBackToControlFromEthernet = document.getElementById('btnBackToControlFromEthernet');
const portList = document.getElementById('portList');
const cardRestart = document.getElementById('cardRestart');

// TU Serisi Öğeleri
const vxControlGrid = document.getElementById('vxControlGrid');
const tuControlGrid = document.getElementById('tuControlGrid');
const vxDevicePanel = document.getElementById('vxDevicePanel');
const tuDevicePanel = document.getElementById('tuDevicePanel');
const deviceEmpty = document.getElementById('deviceEmpty');
const cardScreenToggle = document.getElementById('cardScreenToggle');
const tuCardRestart = document.getElementById('tuCardRestart');
const cardHdmiSource = document.getElementById('cardHdmiSource');
const controlDetailHdmiSource = document.getElementById('control-detail-hdmisource');
const btnBackFromHdmiSource = document.getElementById('btnBackFromHdmiSource');
const cardTuBrightness = document.getElementById('cardTuBrightness');
const cardPower = document.getElementById('cardPower');
const controlDetailPower = document.getElementById('control-detail-power');
const cardVolume = document.getElementById('cardVolume');
const controlDetailVolume = document.getElementById('control-detail-volume');
const btnRefreshTu = document.getElementById('btnRefreshTu'); // Yeni eklendi

// Başlatma
document.addEventListener('DOMContentLoaded', () => {
    console.log('[LEDECA] DOM Hazır.');

    // Listeyi ilk kez doldur (Hafızadaki cihazlar için)
    renderDeviceList();

    // Başlangıçta cihaz sayfasını boş göster
    updateDeviceTypeUI(null);

    // Tarama Butonları
    btnScan?.addEventListener('click', () => startDiscovery());
    btnManualScan?.addEventListener('click', () => {
        const targetIp = manualIpInput.value.trim();
        const series = seriesSelect?.value || 'all';
        if (targetIp) startDiscovery(targetIp, series);
        else showToast('Lütfen bir IP adresi girin.', 'warning');
    });

    // H Serisi - Cihaz Bilgilerini Al
    document.getElementById('btnRefreshHDetails')?.addEventListener('click', () => refreshHDetails());

    // H Serisi - Cihazı Yeniden Başlat
    document.getElementById('btnRestartH')?.addEventListener('click', async () => {
        if (!state.isConnected || state.activeDevice?.type !== 'H') return;
        if (!confirm('Cihazı yeniden başlatmak istediğinizden emin misiniz?')) return;
        try {
            await ControlService.restartH();
            showToast('Cihaz yeniden başlatılıyor...', 'info');
        } catch (err) {
            showToast('Yeniden başlatma başarısız', 'error');
        }
    });

    // H Serisi - FTB (Karartma) Toggle
    document.getElementById('cardHFtb')?.addEventListener('click', async () => {
        if (!state.isConnected || state.activeDevice?.type !== 'H') return;
        try {
            state.isHFtbActive = !state.isHFtbActive;
            await ControlService.setHFtb(state.isHFtbActive);
            const card = document.getElementById('cardHFtb');
            card?.classList.toggle('active-blackout', state.isHFtbActive);
            showToast(state.isHFtbActive ? 'Ekran karartıldı' : 'Ekran açıldı', 'info');
        } catch (err) {
            showToast('FTB işlemi başarısız', 'error');
        }
    });

    // H Serisi - Freeze Screen (W040A) Toggle
    document.getElementById('cardHFreeze')?.addEventListener('click', async () => {
        if (!state.isConnected || state.activeDevice?.type !== 'H') return;
        try {
            state.isHFreezeActive = !state.isHFreezeActive;
            await ControlService.setHFreezeScreen(state.isHFreezeActive);
            const card = document.getElementById('cardHFreeze');
            card?.classList.toggle('active-freeze', state.isHFreezeActive);
            showToast(state.isHFreezeActive ? '❄️ Görüntü donduruldu' : '▶ Görüntü çözüldü', 'info');
        } catch (err) {
            showToast('Freeze işlemi başarısız', 'error');
        }
    });

    // H Serisi - Parlaklık (Subpage)
    document.getElementById('cardHBrightness')?.addEventListener('click', () => {
        if (!state.isConnected || state.activeDevice?.type !== 'H') return;
        const controlHome = document.getElementById('control-home');
        const subpage = document.getElementById('control-detail-h-brightness');
        if (controlHome) controlHome.style.display = 'none';
        if (subpage) subpage.style.display = 'block';
    });

    document.getElementById('btnBackFromHBrightness')?.addEventListener('click', () => {
        const controlHome = document.getElementById('control-home');
        const subpage = document.getElementById('control-detail-h-brightness');
        if (subpage) subpage.style.display = 'none';
        if (controlHome) controlHome.style.display = 'block';
    });

    // H Serisi - Preset (Subpage)
    document.getElementById('cardHPresets')?.addEventListener('click', async () => {
        if (!state.isConnected || state.activeDevice?.type !== 'H') return;
        const controlHome = document.getElementById('control-home');
        const subpage = document.getElementById('control-detail-presets');
        const list = document.getElementById('hPresetList');
        if (controlHome) controlHome.style.display = 'none';
        if (subpage) subpage.style.display = 'block';

        // R0600 ile preset listesini çek
        if (list) list.innerHTML = '<div class="preset-loading">⏳ Presetler getiriliyor...</div>';
        try {
            const response = await ControlService.getHPresets();
            const data = Array.isArray(response) ? response[0] : response;
            // Cihaz presetList / presets / list gibi isimler kullanabilir
            const presets = data?.presetList ?? data?.presets ?? data?.list ?? null;

            if (!presets || presets.length === 0) {
                list.innerHTML = '<div class="preset-loading">ℹ️ Bu cihazda kayıtlı preset bulunamadı.</div>';
                return;
            }

            list.innerHTML = presets.map(p => {
                const id = p.presetId ?? p.id ?? p.preset;
                const name = p.name || `Preset ${id}`;
                return `<button class="btn-preset" data-preset-id="${id}">${name}</button>`;
            }).join('');

            // Her preset butonuna W0605 yükleyici ekle
            list.querySelectorAll('.btn-preset').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const pid = parseInt(btn.dataset.presetId);
                    try {
                        btn.disabled = true;
                        await ControlService.loadHPreset(pid);
                        showToast(`✅ ${btn.textContent} yüklendi`, 'success');
                    } catch (e) {
                        showToast('Preset yükleme başarısız', 'error');
                    } finally {
                        btn.disabled = false;
                    }
                });
            });
        } catch (err) {
            if (list) list.innerHTML = '<div class="preset-loading">⚠️ Preset listesi alınamadı.</div>';
        }
    });

    document.getElementById('btnBackFromHPresets')?.addEventListener('click', () => {
        const controlHome = document.getElementById('control-home');
        const subpage = document.getElementById('control-detail-presets');
        if (subpage) subpage.style.display = 'none';
        if (controlHome) controlHome.style.display = 'block';
    });

    const hBrightnessSlider = document.getElementById('hBrightnessSlider');
    const hBrightnessValue = document.getElementById('hBrightnessValue');
    const btnApplyHBrightness = document.getElementById('btnApplyHBrightness');

    hBrightnessSlider?.addEventListener('input', () => {
        if (hBrightnessValue) hBrightnessValue.textContent = hBrightnessSlider.value;
    });

    btnApplyHBrightness?.addEventListener('click', async () => {
        if (!state.isConnected || state.activeDevice?.type !== 'H') return;
        try {
            await ControlService.setHBrightness(parseInt(hBrightnessSlider.value));
            showToast(`Parlaklık ${hBrightnessSlider.value} olarak ayarlandı`, 'success');
        } catch (err) {
            showToast('Parlaklık ayarı başarısız', 'error');
        }
    });

    // Navigasyon
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const page = e.currentTarget.dataset.page;
            switchPage(page);
        });
    });

    // Bağlantı Kesme
    btnDisconnect?.addEventListener('click', () => handleDisconnect());

    // Alt Sayfa Navigasyonu (Kontrol - Parlaklık)
    cardBrightness?.addEventListener('click', () => {
        controlHome.style.display = 'none';
        controlDetailBrightness.classList.add('active');
    });

    // TU: Parlaklık Kartı — aynı slider alt sayfasını kullanır
    cardTuBrightness?.addEventListener('click', () => {
        controlHome.style.display = 'none';
        controlDetailBrightness.classList.add('active');
    });

    btnBackToControl?.addEventListener('click', () => {
        controlDetailBrightness.classList.remove('active');
        controlHome.style.display = 'block';
    });

    // Alt Sayfa Navigasyonu (Kontrol - VX Presets)
    cardPresets?.addEventListener('click', () => {
        controlHome.style.display = 'none';
        controlDetailPresets.classList.add('active');
        renderPresetButtons(); // isimleri güncelle
    });

    btnBackToControlFromPresets?.addEventListener('click', () => {
        controlDetailPresets.classList.remove('active');
        controlHome.style.display = 'block';
    });

    // VX Preset Butonları — loadPreset(index) çağırır
    document.getElementById('presetButtons')?.addEventListener('click', async (e) => {
        const btn = e.target.closest('.btn-preset');
        if (!btn || !state.isConnected) return;
        const index = parseInt(btn.dataset.index);
        if (isNaN(index)) return;
        try {
            btn.disabled = true;
            await ControlService.loadPreset(index);
            showToast(`✅ ${btn.textContent} yüklendi`, 'success');
        } catch (err) {
            showToast('Preset yükleme başarısız!', 'error');
        } finally {
            btn.disabled = false;
        }
    });

    // Hızlı Karartma (Toggle)
    cardBlackout?.addEventListener('click', async () => {
        if (!state.isConnected) return;

        try {
            const newState = !state.isBlackoutActive;
            await ControlService.setBlackout(newState);
            state.isBlackoutActive = newState;
            state.isFreezeActive = false; // mutually exclusive
            cardBlackout.classList.toggle('active-blackout', state.isBlackoutActive);
            cardFreeze.classList.remove('active-freeze');
            showToast(state.isBlackoutActive ? 'Ekran karartıldı.' : 'Ekran açıldı.', 'info');
        } catch (err) {
            showToast('Karartma işlemi başarısız!', 'error');
        }
    });

    // Görüntüyü Dondur (Toggle)
    cardFreeze?.addEventListener('click', async () => {
        if (!state.isConnected) return;

        try {
            const newState = !state.isFreezeActive;
            await ControlService.setFreeze(newState);
            state.isFreezeActive = newState;
            state.isBlackoutActive = false; // mutually exclusive
            cardFreeze.classList.toggle('active-freeze', state.isFreezeActive);
            cardBlackout.classList.remove('active-blackout');
            showToast(state.isFreezeActive ? 'Görüntü donduruldu.' : 'Görüntü çözüldü.', 'info');
        } catch (err) {
            showToast('Dondurma işlemi başarısız!', 'error');
        }
    });

    // Fan Yenileme
    btnRefreshFan?.addEventListener('click', () => handleRefreshFan());

    // TU Dashboard Yenileme
    const btnRefreshTu = document.getElementById('btnRefreshTu');
    btnRefreshTu?.addEventListener('click', () => {
        console.log('[TU] btnRefreshTu clicked!');
        showToast('Yenileniyor...', 'info');
        refreshTuStatus(true);
    });

    // Ethernet Port Navigasyonu
    cardEthernet?.addEventListener('click', () => {
        document.getElementById('vxDevicePanel').querySelectorAll(':scope > div:not(.device-main-card)').forEach(div => div.style.display = 'none');
        controlDetailEthernet.classList.add('active');
        handleEthernetClick();
    });

    btnBackToControlFromEthernet?.addEventListener('click', () => {
        controlDetailEthernet.classList.remove('active');
        vxDevicePanel.style.display = 'flex';
    });

    // Cihazı Yeniden Başlat (VX)
    cardRestart?.addEventListener('click', () => handleRestart());
    // Cihazı Yeniden Başlat (TU)
    tuCardRestart?.addEventListener('click', () => handleRestart());

    // TU Ekran Aç/Kapat Toggle
    let isScreenOn = true;
    cardScreenToggle?.addEventListener('click', async () => {
        if (!state.isConnected) return;
        try {
            isScreenOn = !isScreenOn;
            await ControlService.setScreen(isScreenOn);
            cardScreenToggle.classList.toggle('active-blackout', !isScreenOn);
            showToast(isScreenOn ? 'Ekran açıldı.' : 'Ekran kapatıldı.', 'info');
        } catch (err) {
            showToast('Ekran komutu başarısız!', 'error');
        }
    });

    // TU Kaynak Seç - Kartı aç
    cardHdmiSource?.addEventListener('click', () => {
        if (!state.isConnected) return;
        controlHome.style.display = 'none';
        controlDetailHdmiSource.classList.add('active');
    });

    // TU Kaynak Seç - Geri
    btnBackFromHdmiSource?.addEventListener('click', () => {
        controlDetailHdmiSource.classList.remove('active');
        controlHome.style.display = 'block';
    });

    // TU Kaynak Seç - Butonlar (sadece data-source içerenler)
    let activeSourceId = null;
    document.querySelectorAll('.btn-source[data-source]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!state.isConnected) return;
            const sourceId = parseInt(btn.dataset.source);
            // User Mapping: 0:Android 1:HDMI1 2:HDMI2 3:HDMI3 (HDMI3 is data-source=4 in some UI, but we'll align)
            const sourceNames = { 0: 'Android', 1: 'HDMI 1', 2: 'HDMI 2', 3: 'HDMI 3' };
            try {
                await ControlService.setSource(sourceId);
                document.querySelectorAll('.btn-source[data-source]').forEach(b => b.classList.remove('active-source'));
                btn.classList.add('active-source');
                activeSourceId = sourceId;
                showToast(`Kaynak: ${sourceNames[sourceId] || sourceId}`, 'success');
            } catch (err) {
                showToast('Kaynak değiştirilemedi!', 'error');
            }
        });
    });

    // TU Ses Kontrolü - Bar
    const volumeSlider = document.getElementById('volumeSlider');
    const volumeValue = document.getElementById('volumeValue');
    volumeSlider?.addEventListener('input', (e) => {
        isUserInteractingWithVolume = true;
        if (volumeValue) volumeValue.textContent = e.target.value;
    });
    volumeSlider?.addEventListener('change', async (e) => {
        if (!state.isConnected) return;
        try {
            await ControlService.setTuVolume(e.target.value);
            showToast(`Ses: %${e.target.value}`, 'info');
        } catch (err) {
            showToast('Ses ayarı başarısız!', 'error');
        } finally {
            // Wait a bit before allowing refresh to overwrite, to let the device state stabilize
            setTimeout(() => { isUserInteractingWithVolume = false; }, 1000);
        }
    });

    // TU Ses Kontrolü - Kartı aç
    cardVolume?.addEventListener('click', () => {
        if (!state.isConnected) return;
        controlHome.style.display = 'none';
        controlDetailVolume.classList.add('active');
    });

    btnBackFromVolume?.addEventListener('click', () => {
        controlDetailVolume.classList.remove('active');
        controlHome.style.display = 'block';
    });

    // TU Güç Kontrolü - Kartı aç
    cardPower?.addEventListener('click', () => {
        if (!state.isConnected) return;
        controlHome.style.display = 'none';
        controlDetailPower.classList.add('active');
    });

    document.getElementById('btnBackFromPower')?.addEventListener('click', () => {
        controlDetailPower.classList.remove('active');
        controlHome.style.display = 'block';
    });

    const powerActions = [
        { id: 'btnStandby', action: 'standby', label: 'Bekleme moduna alındı.' },
        { id: 'btnWakeup', action: 'wakeup', label: 'Cihaz uyandırıldı.' },
        { id: 'btnPowerOff', action: 'poweroff', label: 'Cihaz kapatılıyor...' },
    ];
    powerActions.forEach(({ id, action, label }) => {
        document.getElementById(id)?.addEventListener('click', async () => {
            if (!state.isConnected) return;
            try {
                await ControlService.powerControl(action);
                showToast(label, 'success');
            } catch (err) {
                showToast('Güç komutu gönderilemedi!', 'error');
            }
        });
    });

    // TU Ses Kontrolü - Kartı aç
    cardVolume?.addEventListener('click', () => {
        if (!state.isConnected) return;
        controlHome.style.display = 'none';
        controlDetailVolume.classList.add('active');
    });

    document.getElementById('btnBackFromVolume')?.addEventListener('click', () => {
        controlDetailVolume.classList.remove('active');
        controlHome.style.display = 'block';
    });

    document.getElementById('btnVolumeUp')?.addEventListener('click', async () => {
        if (!state.isConnected) return;
        try {
            await ControlService.volumeControl('up');
            showToast('Ses artırıldı.', 'success');
        } catch (err) { showToast('Ses komutu gönderilemedi!', 'error'); }
    });

    document.getElementById('btnVolumeDown')?.addEventListener('click', async () => {
        if (!state.isConnected) return;
        try {
            await ControlService.volumeControl('down');
            showToast('Ses azaltıldı.', 'success');
        } catch (err) { showToast('Ses komutu gönderilemedi!', 'error'); }
    });

    // TU Refresh Btn
    btnRefreshTu?.addEventListener('click', () => {
        refreshTuStatus();
    });

    // TU Uzaktan Kumanda - Kartı aç
    const cardRemote = document.getElementById('cardRemote');
    const controlDetailRemote = document.getElementById('control-detail-remote');

    cardRemote?.addEventListener('click', () => {
        if (!state.isConnected) return;
        controlHome.style.display = 'none';
        controlDetailRemote.classList.add('active');
    });

    document.getElementById('btnBackFromRemote')?.addEventListener('click', () => {
        controlDetailRemote.classList.remove('active');
        controlHome.style.display = 'block';
    });

    // TU Uzaktan Kumanda - Tüm tuşlar (btn-rmt ve btn-dpad)
    const remoteKeyLabels = {
        home: 'Ana Sayfa', back: 'Geri', menu: 'Menü',
        power: 'Güç', source: 'Kaynak',
        volup: 'Ses+', voldown: 'Ses−',
        up: '▲', down: '▼', left: '◄', right: '►', ok: 'OK'
    };

    controlDetailRemote?.querySelectorAll('[data-key]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!state.isConnected) return;
            const key = btn.dataset.key;
            try {
                await ControlService.remoteControl(key);
                showToast(remoteKeyLabels[key] || key, 'info');
            } catch (err) {
                showToast('Komut gönderilemedi!', 'error');
            }
        });
    });

    // Preset Butonları (Click & Long Press)
    let pressTimer;
    document.querySelectorAll('.btn-preset').forEach(btn => {
        const startPress = (e) => {
            btn.classList.add('long-press-ready');
            pressTimer = window.setTimeout(() => {
                btn.classList.remove('long-press-ready');
                btn.classList.add('long-press-active');
                handlePresetRename(btn.dataset.index);
            }, 800);
        };

        const cancelPress = () => {
            window.clearTimeout(pressTimer);
            btn.classList.remove('long-press-ready', 'long-press-active');
        };

        // Desktop
        btn.addEventListener('mousedown', startPress);
        btn.addEventListener('mouseup', (e) => {
            if (btn.classList.contains('long-press-ready')) {
                handlePresetClick(btn.dataset.index);
            }
            cancelPress();
        });
        btn.addEventListener('mouseleave', cancelPress);

        // Mobile
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault(); // Prevent ghost clicks
            startPress(e);
        });
        btn.addEventListener('touchend', (e) => {
            if (btn.classList.contains('long-press-ready')) {
                handlePresetClick(btn.dataset.index);
            }
            cancelPress();
        });
        btn.addEventListener('touchcancel', cancelPress);
    });

    // Parlaklık Sliderı
    brightnessSlider?.addEventListener('input', (e) => {
        brightnessValue.textContent = e.target.value;
    });

    brightnessSlider?.addEventListener('change', async (e) => {
        const val = e.target.value;
        try {
            // Cihaz tipine göre doğru protokol
            if (state.activeDevice?.type === 'TU') {
                await ControlService.setTuBrightness(parseInt(val));
            } else {
                await ControlService.setBrightness(val);
            }
            showToast(`Parlaklık ${val} olarak güncellendi.`, 'success');
        } catch (err) {
            showToast('Komut gönderilemedi.', 'error');
        }
    });
});

/**
 * Cihaz Keşif İşlemi (Unified)
 */
async function startDiscovery(targetIp = null, series = null) {
    const selectedSeries = series || seriesSelect?.value || 'all';

    if (targetIp) {
        console.log(`[LEDECA] TCP Sorgulama: ${targetIp} (${selectedSeries})`);
        showToast('Cihaz sorgulanıyor...', 'info');
        setScanUI(true);
        try {
            // Manuel sorguda DiscoveryService.scan kullanarak series filtresine uyuyoruz
            await DiscoveryService.scan((device) => {
                addDevice(device);
            }, { targetAddress: targetIp, series: selectedSeries });
            setScanUI(false);
        } catch (err) { handleDiscoveryError(err); }
    } else {
        console.log(`[LEDECA] Tarama başlatılıyor: ${selectedSeries}`);
        showToast('Ağ taranıyor...', 'info');
        setScanUI(true);

        try {
            await DiscoveryService.scan((device) => {
                addDevice(device);
            }, {
                series: selectedSeries,
                onProgress: (status, percent) => {
                    updateProgressUI(status, percent);
                }
            });
            setTimeout(() => setScanUI(false), 1000);
        } catch (err) { handleDiscoveryError(err); }
    }
}

function addDevice(device) {
    if (state.devices.find(d => d.ip === device.ip)) return;
    state.devices.push(device);
    localStorage.setItem('ledeca_found_devices', JSON.stringify(state.devices));
    renderDeviceList();
}

function updateProgressUI(status, percent) {
    if (scanStatusText) scanStatusText.textContent = status;
    if (scanPercentage) scanPercentage.textContent = `${percent}%`;
    if (scanProgressBar) scanProgressBar.style.width = `${percent}%`;
}

function setScanUI(isScanning) {
    btnScan.disabled = isScanning;
    if (btnManualScan) btnManualScan.disabled = isScanning;
    if (seriesSelect) seriesSelect.disabled = isScanning;

    if (isScanning) {
        btnScan.classList.add('scanning');
        if (scanProgressContainer) scanProgressContainer.style.display = 'block';
        updateProgressUI('Başlatılıyor...', 0);
    } else {
        btnScan.classList.remove('scanning');
        if (scanProgressContainer) scanProgressContainer.style.display = 'none';
        if (state.devices.length === 0) {
            deviceList.innerHTML = `<div class="empty-state">Cihaz bulunamadı.</div>`;
        }
    }
}

function handleDiscoveryError(err) {
    setScanUI(false);
    if (scanProgressContainer) scanProgressContainer.style.display = 'none';
    deviceList.innerHTML = `<div class="error-state"><p>Hata: ${err.message}</p></div>`;
    showToast('Tarama hatası!', 'error');
}

function renderDeviceList() {
    if (state.devices.length === 0) {
        deviceList.innerHTML = `<div class="empty-state">Cihaz bulunamadı. Lütfen tarama yapın.</div>`;
        return;
    }

    deviceList.innerHTML = state.devices.map(device => {
        const isTU = device.type === 'TU';
        const isH = device.type === 'H';
        const modelLabel = isH ? 'H Series' : (isTU ? 'TU Series' : 'VXPro');
        const badgeClass = isH ? 'h-badge' : (isTU ? 'tu-badge' : 'vx-badge');
        const themeClass = isH ? 'h-theme' : (isTU ? 'tu-theme' : 'vx-theme');
        const thumbSrc = isH ? hDeviceImage : (isTU ? tuDeviceImage : vxDeviceImage);

        return `
        <div class="device-card ${themeClass} ${state.isConnected && state.activeDevice.ip === device.ip ? 'active' : ''}">
            <div class="device-icon">
                <img src="${thumbSrc}" alt="${modelLabel}" style="width: 100%; height: 100%; object-fit: contain;">
            </div>
            <div class="device-info">
                <div class="device-name-row">
                    <div class="device-name">${device.deviceName || 'Novastar Device'}</div>
                    <span class="device-type-badge ${badgeClass}">${modelLabel}</span>
                </div>
                <div class="device-details">SN: ${device.SN} | IP: ${device.ip}</div>
            </div>
            <div class="device-action">
                ${state.isConnected && state.activeDevice.ip === device.ip
                ? '<span class="status-badge connected">Bağlı</span>'
                : `<button class="btn-connect-small" data-ip="${device.ip}" data-sn="${device.SN}" data-type="${device.type}">Bağlan</button>`
            }
            </div>
        </div>
    `}).join('');

    deviceList.querySelectorAll('.btn-connect-small').forEach(btn => {
        btn.addEventListener('click', (e) => handleConnect(e.target.dataset.ip, e.target.dataset.sn, e.target.dataset.type));
    });
}

async function handleConnect(ip, sn, type) {
    showToast('Bağlanılıyor...', 'info');
    const port = type === 'H' ? 6000 : (type === 'TU' ? 5201 : 15200);

    try {
        const success = await ControlService.connect(ip, port);
        if (success) {
            state.isConnected = true;
            state.activeDevice = { ip, sn, type };
            updateConnectionUI(true, ip);
            updateDeviceTypeUI(type, ip);
            if (type !== 'TU') handleRefreshFan(); // Fan sadece VX için
            showToast('Bağlantı başarılı.', 'success');
        }
    } catch (err) {
        showToast('Bağlantı başarısız!', 'error');
        updateConnectionUI(false);
    }
}

async function handleDisconnect() {
    try {
        await ControlService.disconnect();
        state.isConnected = false;
        state.activeDevice = null;
        state.isBlackoutActive = false;
        state.isFreezeActive = false;
        cardBlackout?.classList.remove('active-blackout');
        cardFreeze?.classList.remove('active-freeze');
        
        if (tuStatusInterval) {
            clearInterval(tuStatusInterval);
            tuStatusInterval = null;
        }

        updateConnectionUI(false);
        updateDeviceTypeUI(null);
        showToast('Bağlantı kesildi.', 'info');
    } catch (err) { }
}

/**
 * Cihaz tipine göre UI panellerini göster/gizle
 * @param {string|null} type 'VX' | 'TU' | null (bağlı değil)
 * @param {string} ip
 */
function updateDeviceTypeUI(type, ip = '') {
    const isVX = type === 'VX';
    const isTU = type === 'TU';
    const isConnected = type !== null;

    // Kontrol Paneli
    const isH = type === 'H';
    if (vxControlGrid) vxControlGrid.style.display = isVX ? 'grid' : 'none';
    if (tuControlGrid) tuControlGrid.style.display = isTU ? 'grid' : 'none';
    const hControlGrid = document.getElementById('hControlGrid');
    if (hControlGrid) hControlGrid.style.display = isH ? 'grid' : 'none';

    // Cihaz Paneli
    if (deviceEmpty) deviceEmpty.style.display = isConnected ? 'none' : 'block';
    if (vxDevicePanel) vxDevicePanel.style.display = isVX ? 'flex' : 'none';
    if (tuDevicePanel) tuDevicePanel.style.display = isTU ? 'flex' : 'none';
    const hDevicePanel = document.getElementById('h-device-panel');
    if (hDevicePanel) hDevicePanel.style.display = type === 'H' ? 'block' : 'none';

    // H cihaz bilgileri güncelle
    if (type === 'H') {
        const hIp = document.getElementById('hInfoDeviceIp');
        const hStatus = document.getElementById('hInfoDeviceStatus');
        if (hIp) hIp.textContent = ip;
        if (hStatus) { hStatus.textContent = 'Bağlı'; hStatus.className = 'status-badge connected'; }
    }

    // TU cihaz bilgileri güncelle
    if (isTU) {
        const tuIp = document.getElementById('tuInfoDeviceIp');
        const tuStatus = document.getElementById('tuInfoDeviceStatus');
        const tuDashboard = document.getElementById('tuStatusDashboard');

        if (tuIp) tuIp.textContent = ip;
        if (tuStatus) {
            tuStatus.textContent = 'Bağlı';
            tuStatus.className = 'status-badge connected';
        }
        if (tuDashboard) tuDashboard.style.display = 'flex';

        // Durumları hemen çek (otomatik yenileme kaldırıldı)
        refreshTuStatus();
    } else {
        if (tuStatusInterval) {
            clearInterval(tuStatusInterval);
            tuStatusInterval = null;
        }
    }
    // VX cihaz bilgileri zaten updateConnectionUI ile güncelleniyor
}

let isRefreshingTuStatus = false;
let isRefreshingHDetails = false;

/**
 * Fetch H Series R0100 device details and update the UI
 */
async function refreshHDetails() {
    if (isRefreshingHDetails || state.activeDevice?.type !== 'H') return;
    isRefreshingHDetails = true;
    const btn = document.getElementById('btnRefreshHDetails');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
    try {
        const response = await ControlService.sendHCommand({ cmd: 'R0100', param0: 0 });
        const data = Array.isArray(response) ? response[0] : response;
        if (!data) return;

        const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val ?? '---'; };
        set('valHName', data.name || '(İsimsiz)');
        set('valHModelId', data.modelId);
        set('valHMac', data.MAC);

        // Network info: IP & Subnet
        if (data.networkList && data.networkList.length > 0) {
            const net = data.networkList[0];
            set('valHNetwork', `${net.ip || state.activeDevice.ip} / ${net.subnetMask || '---'}`);
        } else {
            set('valHNetwork', state.activeDevice?.ip || '---');
        }

        // Temp — only Normal/Anormal badge, no numeric value
        set('valHTemp', ''); // numeric değer gösterilmez
        const tempBadge = document.getElementById('valHTempStatus');
        if (tempBadge && data.temp !== undefined) {
            const tempSt = data.tempStatus ?? 0; // default Normal if device doesn't send field
            tempBadge.style.display = 'inline-block';
            if (tempSt === 0) {
                tempBadge.textContent = '✅ Normal'; tempBadge.className = 'h-status-badge normal';
            } else {
                tempBadge.textContent = '⚠️ Anormal'; tempBadge.className = 'h-status-badge abnormal';
            }
        }

        // Volt — only Normal/Anormal badge, no numeric value
        set('valHVolt', ''); // numeric değer gösterilmez
        const voltBadge = document.getElementById('valHVoltStatus');
        if (voltBadge && data.volt !== undefined) {
            const voltSt = data.voltStatus ?? 0; // default Normal if device doesn't send field
            voltBadge.style.display = 'inline-block';
            if (voltSt === 0) {
                voltBadge.textContent = '✅ Normal'; voltBadge.className = 'h-status-badge normal';
            } else {
                voltBadge.textContent = '⚠️ Anormal'; voltBadge.className = 'h-status-badge abnormal';
            }
        }


        // Fan listesi
        const fanList = document.getElementById('hFanList');
        if (fanList && data.fanList && data.fanList.length > 0) {
            fanList.innerHTML = data.fanList.map(f =>
                `<div class="fan-item"><span class="fan-name">Fan ${f.fanId}</span><span class="fan-speed">${f.status === 0 ? '✅ Normal' : '⚠️ Hata'}</span></div>`
            ).join('');
        }

        const dashboard = document.getElementById('hStatusDashboard');
        if (dashboard) dashboard.style.display = 'block';

        showToast('Cihaz bilgileri alındı', 'success');
    } catch (err) {
        console.error('[H] R0100 failed:', err);
        showToast('Cihaz bilgileri alınamadı', 'error');
    } finally {
        isRefreshingHDetails = false;
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    }
}


/**
 * Fetch and update TU Dashboard values
 */
async function refreshTuStatus(isManual = false) {
    if (isRefreshingTuStatus || state.activeDevice?.type !== 'TU') {
        console.log(`[TU] refresh ignored. isRefreshing: ${isRefreshingTuStatus}, type: ${state.activeDevice?.type}`);
        return;
    }

    isRefreshingTuStatus = true;
    const btnRefresh = document.getElementById('btnRefreshTu');
    if (btnRefresh) btnRefresh.style.opacity = '0.5';

    try {
        // Receiver Card Hardware Status (Brightness, Voltage, Temp)
        const hwStat = await ControlService.readTuHardwareStatus();
        if (hwStat) {
            const valB = document.getElementById('valTuBrightness');
            const valV = document.getElementById('valTuVoltage');
            const valT = document.getElementById('valTuTemp');
            if (valB) valB.textContent = hwStat.brightness !== undefined ? hwStat.brightness : '---';
            if (valV) valV.textContent = hwStat.voltage !== undefined ? hwStat.voltage + ' V' : '---';
            if (valT) valT.textContent = hwStat.temperature !== undefined ? hwStat.temperature + ' °C' : '---';
        }

        // Hotspot (0x08)
        const hs = await ControlService.readTuStatus(0x08);
        if (hs) {
            const valHs = document.getElementById('valTuHotspot');
            if (valHs) {
                if (hs.error) valHs.textContent = 'Hata';
                else valHs.textContent = hs.on ? `Açık (${hs.band}, Ch: ${hs.channel})` : 'Kapalı';
            }
        }

        // LAN (0x07)
        const lan = await ControlService.readTuStatus(0x07);
        if (lan) {
            const valLan = document.getElementById('valTuLan');
            if (valLan) valLan.textContent = lan.connected ? 'Bağlı' : 'Bağlı Değil';
        }

        // Ethernet Link Status
        const linkStatus = await ControlService.readTuLinkStatus();
        renderTuPortGrid(linkStatus);

        // HDMI Sources (0x02, 0x04, 0x05)
        const currSrc = await ControlService.readTuStatus(0x04);
        const volStat = await ControlService.readTuStatus(0x05);
        
        // Update Dashboard Source
        const valTuSource = document.getElementById('valTuSource');
        if (valTuSource && currSrc) {
            valTuSource.textContent = currSrc.source || '---';
        }

        // Update Volume UI if details page might be open
        if (volStat) {
            const vSlider = document.getElementById('volumeSlider');
            const vText = document.getElementById('volumeValue');
            if (vSlider && !isUserInteractingWithVolume) {
                vSlider.value = volStat.volume;
                if (vText) vText.textContent = volStat.volume;
            }
        }

        // Highlight Active Source Button
        if (currSrc) {
            // Source Mapping: Android:0, HDMI1:1, HDMI2:2, HDMI3:3
            const srcMap = { 'Android': 0, 'HDMI1': 1, 'HDMI2': 2, 'HDMI3': 3 };
            const activeId = srcMap[currSrc.source];
            document.querySelectorAll('.btn-source[data-source]').forEach(btn => {
                if (parseInt(btn.dataset.source) === activeId) {
                    btn.classList.add('active-source');
                } else {
                    btn.classList.remove('active-source');
                }
            });
        }

        const hdmiStat = await ControlService.readTuStatus(0x02);
        if (hdmiStat) {
            const b1 = document.getElementById('badgeHdmi1');
            const b2 = document.getElementById('badgeHdmi2');
            const b3 = document.getElementById('badgeHdmi3');
            const bA = document.getElementById('badgeAndroid');
            
            if (b1) { b1.className = 'hdmi-badge'; if (hdmiStat.hdmi1) b1.classList.add('active'); b1.style.borderColor = currSrc?.source === 'HDMI1' ? '#34c759' : ''; }
            if (b2) { b2.className = 'hdmi-badge'; if (hdmiStat.hdmi2) b2.classList.add('active'); b2.style.borderColor = currSrc?.source === 'HDMI2' ? '#34c759' : ''; }
            if (b3) { b3.className = 'hdmi-badge'; if (hdmiStat.hdmi3) b3.classList.add('active'); b3.style.borderColor = currSrc?.source === 'HDMI3' ? '#34c759' : ''; }
            if (bA) { bA.className = 'hdmi-badge'; if (hdmiStat.android) bA.classList.add('active'); bA.style.borderColor = currSrc?.source === 'Android' ? '#34c759' : ''; }
        }

    } catch (e) {
        console.error('[TU] Refresh Dashboard Error:', e);
    } finally {
        isRefreshingTuStatus = false;
        if (btnRefresh) btnRefresh.style.opacity = '1';
    }
}

function renderTuPortGrid(linkStatus) {
    const grid = document.getElementById('tuPortGrid');
    if (!grid) return;

    if (!linkStatus || !linkStatus.ports) {
        grid.innerHTML = '<div class="tu-port-placeholder">Bağlantı bilgisi alınamadı.</div>';
        return;
    }

    let html = '';
    for (let i = 0; i < 20; i++) {
        const isLinked = linkStatus.ports[i];
        html += `<div class="tu-port-dot ${isLinked ? 'active' : ''}" title="Port ${i+1}"><span>${i+1}</span></div>`;
    }
    grid.innerHTML = html;
}

function updateConnectionUI(isConnected, ip = '') {
    connectionStatus.textContent = isConnected ? 'Bağlı' : 'Cihaz Bağlı Değil';
    connectionStatus.className = `status-badge ${isConnected ? 'connected' : 'disconnected'}`;
    activeDeviceInfo.style.display = isConnected ? 'flex' : 'none';
    connectedDeviceName.textContent = ip;

    // Cihaz Sayfası Güncelleme
    if (infoDeviceIp) infoDeviceIp.textContent = isConnected ? ip : '---.---.---.---';
    if (infoDeviceStatus) {
        infoDeviceStatus.textContent = isConnected ? 'Bağlı' : 'Bağlı Değil';
        infoDeviceStatus.className = `status-badge ${isConnected ? 'connected' : 'disconnected'}`;
    }

    renderDeviceList();
}

/**
 * Handle Fan Status Refresh
 */
async function handleRefreshFan() {
    if (!state.isConnected) {
        showToast('Fan durumunu görmek için cihaz bağlı olmalı.', 'warning');
        return;
    }

    fanList.innerHTML = '<div class="fan-item-placeholder">Güncelleniyor...</div>';
    try {
        const fans = await ControlService.getFanStatus();
        renderFanList(fans);
    } catch (err) {
        fanList.innerHTML = '<div class="fan-item-placeholder error">Veri alınamadı.</div>';
    }
}

function renderFanList(fans) {
    if (!fans || fans.length === 0) {
        fanList.innerHTML = '<div class="fan-item-placeholder">Fan bilgisi bulunamadı.</div>';
        return;
    }

    fanList.innerHTML = fans.map(fan => `
        <div class="fan-item">
            <div class="fan-info-left">
                <span class="fan-icon">${fan.state === 1 ? '🟢' : '⚪'}</span>
                <span class="fan-name">Fan ${fan.index}</span>
            </div>
            <div class="fan-speed">${fan.speed} RPM</div>
        </div>
    `).join('');
}

/**
 * Handle Ethernet Port Info Fetch
 */
async function handleEthernetClick() {
    if (!state.isConnected) {
        showToast('Port durumunu görmek için cihaz bağlı olmalı.', 'warning');
        return;
    }

    portList.innerHTML = '<div class="fan-item-placeholder">Portlar taranıyor...</div>';
    try {
        const ports = await ControlService.getPortBackupStatus();
        renderPortList(ports);
    } catch (err) {
        portList.innerHTML = '<div class="fan-item-placeholder error">Veri alınamadı.</div>';
    }
}

function renderPortList(ports) {
    if (!ports || ports.length === 0) {
        portList.innerHTML = '<div class="fan-item-placeholder">Port bilgisi bulunamadı.</div>';
        return;
    }

    portList.innerHTML = ports.map(port => `
        <div class="port-item ${port.status === 0 ? 'primary' : 'backup'}">
            <span class="port-id">${port.id}</span>
            <span class="port-status-label">${port.status === 0 ? 'ASIL' : 'YEDEK'}</span>
        </div>
    `).join('');
}

/**
 * Handle Restart Device
 */
async function handleRestart() {
    if (!state.isConnected) return;

    const confirmed = confirm('DİKKAT: Cihaz yeniden başlatılacaktır. Bağlantınız kesilecek. Emin misiniz?');

    if (confirmed) {
        showToast('Yeniden başlatma komutu gönderiliyor...', 'warning');
        try {
            await ControlService.restartDevice();
            showToast('Komut başarılı. Cihaz yeniden başlatılıyor.', 'success');

            // Cihaz yeniden başlayacağı için bağlantıyı kes ve keşif sayfasına dön
            setTimeout(async () => {
                await handleDisconnect();
                switchPage('discovery');
            }, 2000);
        } catch (err) {
            showToast('Yeniden başlatma işlemi başarısız!', 'error');
        }
    }
}

function switchPage(pageId) {
    state.currentPage = pageId;
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${pageId}`));
    document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.page === pageId));

    if (pageId === 'control') {
        controlPanel.classList.toggle('locked', !state.isConnected);
        connectedDeviceSubtitle.textContent = state.isConnected ? `Cihaz: ${state.activeDevice.ip}` : 'Lütfen bir cihaza bağlanın.';
        // Her girişte alt sayfaları kapat, ana menüyü göster
        controlDetailBrightness.classList.remove('active');
        controlDetailPresets.classList.remove('active');
        controlHome.style.display = 'block';
    }

    if (pageId === 'device') {
        // Ethernet alt sayfasını kapat
        controlDetailEthernet.classList.remove('active');
        // Cihaz tipine göre doğru paneli göster
        const t = state.activeDevice?.type || null;
        updateDeviceTypeUI(t, state.activeDevice?.ip || '');
    }
}

/**
 * Handle Preset Load Command
 */
async function handlePresetClick(index) {
    console.log('[LEDECA] Loading preset:', parseInt(index) + 1);
    try {
        await ControlService.loadPreset(index);
        showToast(`Preset ${parseInt(index) + 1} yüklendi.`, 'success');
    } catch (err) {
        showToast('Preset yüklenemedi.', 'error');
    }
}

/**
 * Handle Preset Renaming (Long Press)
 */
function handlePresetRename(index) {
    const currentName = state.presetNames[index] || `Preset ${parseInt(index) + 1}`;
    const newName = prompt('Preset için yeni bir isim girin:', currentName);

    if (newName !== null && newName.trim() !== '') {
        state.presetNames[index] = newName.trim();
        localStorage.setItem('ledeca_preset_names', JSON.stringify(state.presetNames));
        renderPresetButtons();
        showToast('İsim güncellendi.', 'success');
    }
}

/**
 * Update Preset Button Labels from state
 */
function renderPresetButtons() {
    document.querySelectorAll('.btn-preset').forEach(btn => {
        const index = btn.dataset.index;
        const name = state.presetNames[index] || `Preset ${parseInt(index) + 1}`;
        btn.textContent = name;
    });
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}
