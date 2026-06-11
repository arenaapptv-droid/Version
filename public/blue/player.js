/**
 * MOODY TV - Professional Video Player
 * HLS/DASH support, DVR/TimeShift, Fullscreen, Quality switching, PiP, Keyboard shortcuts
 */

(function() {
    'use strict';

    // ============================================
    // Elements
    // ============================================
    const wrapper = document.getElementById('playerWrapper');
    const video = document.getElementById('videoPlayer');
    const loading = document.getElementById('playerLoading');
    const errorOverlay = document.getElementById('playerError');
    const errorText = document.getElementById('playerErrorText');
    const controls = document.getElementById('playerControls');

    const btnPlayPause = document.getElementById('btnPlayPause');
    const btnMute = document.getElementById('btnMute');
    const btnFullscreen = document.getElementById('btnFullscreen');
    // btnPip removed
    const btnQuality = document.getElementById('btnQuality');
    const btnLive = document.getElementById('btnLive');
    const volumeSlider = document.getElementById('volumeSlider');

    const progressWrapper = document.getElementById('progressWrapper');
    const progressPlayed = document.getElementById('progressPlayed');
    const progressBuffered = document.getElementById('progressBuffered');
    const progressHandle = document.getElementById('progressHandle');
    const currentTimeEl = document.getElementById('currentTime');
    const totalTimeEl = document.getElementById('totalTime');
    const qualityDropdown = document.getElementById('qualityDropdown');
    const qualityTracker = document.getElementById('qualityTracker');
    const playerCloseBtn = document.getElementById('playerCloseBtn');
    const manualRetryBtn = document.getElementById('manualRetryBtn');

    if (!wrapper || !video) return;

    // ============================================
    // State
    // ============================================
    let hlsPlayer = null;
    let dashPlayer = null;
    let isDVR = false;
    let isAtLiveEdge = true;
    let controlsTimeout = null;
    let adPlaying = false;

    // ============================================
    // Helper Functions
    // ============================================
    function showLoading(show) { if (loading) loading.style.display = show ? 'flex' : 'none'; }
    function showError(show, message) {
        if (errorOverlay) errorOverlay.style.display = show ? 'flex' : 'none';
        if (errorText && message) errorText.textContent = message;
        if (show) showLoading(false);
    }
    function formatTime(seconds) {
        seconds = Math.abs(Math.round(seconds));
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = seconds % 60;
        if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
        return m + ':' + String(s).padStart(2, '0');
    }
    function updatePlayPauseIcon() { if (btnPlayPause) btnPlayPause.innerHTML = `<span class="material-icons-round">${video.paused ? 'play_arrow' : 'pause'}</span>`; }
    function updateMuteUI() {
        if (!btnMute) return;
        if (video.muted || video.volume === 0) btnMute.innerHTML = '<span class="material-icons-round">volume_off</span>';
        else if (video.volume < 0.5) btnMute.innerHTML = '<span class="material-icons-round">volume_down</span>';
        else btnMute.innerHTML = '<span class="material-icons-round">volume_up</span>';
        if (volumeSlider) volumeSlider.value = video.muted ? 0 : video.volume;
    }
    function toggleFullscreen() {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            if (wrapper.requestFullscreen) wrapper.requestFullscreen();
            else if (wrapper.webkitRequestFullscreen) wrapper.webkitRequestFullscreen();
            else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
        } else {
            if (document.exitFullscreen) document.exitFullscreen();
            else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        }
    }
    function seekToLive() {
        if (video.seekable && video.seekable.length > 0) {
            video.currentTime = Math.max(video.seekable.end(0) - 2, video.seekable.start(0));
            isAtLiveEdge = true;
        }
    }
    function playVideo() {
        const promise = video.play();
        if (promise) promise.catch(() => { video.muted = true; video.play().catch(()=>{}); });
    }
    function togglePlay() {
        if (adPlaying) return;
        if (video.paused) { playVideo(); wrapper.classList.remove('paused'); }
        else { video.pause(); wrapper.classList.add('paused'); }
    }

    // ============================================
    // DVR / TimeShift
    // ============================================
    function updateDVRProgress() {
        if (!isDVR || !video.seekable || video.seekable.length === 0) return;
        const start = video.seekable.start(0);
        const end = video.seekable.end(0);
        const duration = end - start;
        const currentPos = video.currentTime - start;
        const percent = (currentPos / duration) * 100;
        if (progressPlayed) progressPlayed.style.width = Math.min(percent, 100) + '%';
        if (progressHandle) progressHandle.style.left = Math.min(percent, 100) + '%';
        isAtLiveEdge = (end - video.currentTime) < 5;
        if (btnLive) {
            if (isAtLiveEdge) { btnLive.classList.add('is-live'); btnLive.innerHTML = 'مباشر'; }
            else { btnLive.classList.remove('is-live'); btnLive.innerHTML = 'العودة إلى المباشر'; }
        }
        if (currentTimeEl) currentTimeEl.textContent = formatTime(currentPos);
        if (totalTimeEl) totalTimeEl.textContent = formatTime(duration);
    }

    function updateBuffered() {
        if (!progressBuffered || !video.buffered || video.buffered.length === 0) return;
        if (!isDVR || !video.seekable || video.seekable.length === 0) return;
        const start = video.seekable.start(0);
        const end = video.seekable.end(0);
        const duration = end - start;
        const buffEnd = video.buffered.end(video.buffered.length - 1);
        const percent = ((buffEnd - start) / duration) * 100;
        progressBuffered.style.width = Math.min(percent, 100) + '%';
    }

    function checkDVRSupport() {
        video.addEventListener('timeupdate', function() {
            if (video.seekable && video.seekable.length > 0) {
                const start = video.seekable.start(0);
                const end = video.seekable.end(0);
                const duration = end - start;
                if (duration > 15) {
                    if (!isDVR) {
                        isDVR = true;
                        if (btnLive) btnLive.style.display = 'inline-flex';
                    }
                    updateDVRProgress();
                } else {
                    if (isDVR) {
                        isDVR = false;
                        if (btnLive) btnLive.style.display = 'none';
                    }
                }
            }
        });
    }

    // ============================================
    // Quality Levels
    // ============================================
    function setupQualityLevels(levels) {
        if (!qualityDropdown || !levels || levels.length <= 1) return;
        let html = '<button class="quality-option active" data-level="-1">تلقائي</button>';
        levels.forEach((level, idx) => {
            let label = level.height ? (level.height >= 1080 ? 'عالية (1080p)' : (level.height >= 720 ? 'متوسطة (720p)' : `منخفضة (${level.height}p)`)) : `جودة ${idx+1}`;
            html += `<button class="quality-option" data-level="${idx}">${label}</button>`;
        });
        qualityDropdown.innerHTML = html;
        qualityDropdown.querySelectorAll('.quality-option').forEach(btn => {
            btn.addEventListener('click', function() {
                const level = parseInt(this.dataset.level);
                if (hlsPlayer) hlsPlayer.currentLevel = level;
                if (qualityTracker) qualityTracker.textContent = this.textContent.split(' ')[0];
                qualityDropdown.querySelectorAll('.quality-option').forEach(o => o.classList.remove('active'));
                this.classList.add('active');
                qualityDropdown.style.display = 'none';
            });
        });
    }

    // ============================================
    // HLS.js Player
    // ============================================
    function initHLS(url) {
        if (hlsPlayer) { hlsPlayer.destroy(); hlsPlayer = null; }
        if (Hls.isSupported()) {
            hlsPlayer = new Hls({
                maxBufferLength: 60,
                liveSyncDurationCount: 2,
                enableWorker: true,
                xhrSetup: (xhr) => { xhr.withCredentials = false; }
            });
            hlsPlayer.loadSource(url);
            hlsPlayer.attachMedia(video);
            hlsPlayer.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                showLoading(false);
                playVideo();
                setupQualityLevels(data.levels);
                checkDVRSupport();
            });
            hlsPlayer.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) showError(true, 'حدث خطأ في تحميل البث');
            });
            hlsPlayer.on(Hls.Events.FRAG_BUFFERED, () => updateBuffered());
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
            video.addEventListener('loadedmetadata', () => {
                showLoading(false);
                playVideo();
                checkDVRSupport();
            });
        } else {
            showError(true, 'المتصفح لا يدعم تشغيل HLS');
        }
    }

    // ============================================
    // Main Initializer
    // ============================================
    window.initPlayerFromGlobal = function() {
        if (!window.CHANNEL_DATA) return;
        const streamUrl = window.CHANNEL_DATA.streamUrl;
        showLoading(true);
        showError(false);
        if (hlsPlayer) { hlsPlayer.destroy(); hlsPlayer = null; }
        video.pause();
        video.removeAttribute('src');
        video.load();
        isDVR = false;
        if (btnLive) btnLive.style.display = 'none';
        initHLS(streamUrl);
    };

    // ============================================
    // Event Listeners
    // ============================================
    if (btnPlayPause) btnPlayPause.addEventListener('click', togglePlay);
    if (btnMute) btnMute.addEventListener('click', () => { video.muted = !video.muted; updateMuteUI(); });
    if (volumeSlider) volumeSlider.addEventListener('input', function() { video.volume = parseFloat(this.value); video.muted = (this.value == 0); updateMuteUI(); });
    if (btnFullscreen) btnFullscreen.addEventListener('click', toggleFullscreen);
    if (btnLive) btnLive.addEventListener('click', seekToLive);
    if (btnQuality && qualityDropdown) {
        btnQuality.addEventListener('click', (e) => { e.stopPropagation(); qualityDropdown.style.display = qualityDropdown.style.display === 'none' ? 'block' : 'none'; });
        document.addEventListener('click', () => { if (qualityDropdown) qualityDropdown.style.display = 'none'; });
    }
    if (progressWrapper) {
        progressWrapper.addEventListener('click', (e) => {
            if (!video.duration && !isDVR) return;
            const rect = progressWrapper.getBoundingClientRect();
            let percent = (e.clientX - rect.left) / rect.width;
            percent = Math.min(1, Math.max(0, percent));
            if (isDVR && video.seekable && video.seekable.length) {
                const start = video.seekable.start(0);
                const end = video.seekable.end(0);
                video.currentTime = start + (percent * (end - start));
            } else {
                video.currentTime = percent * video.duration;
            }
        });
    }
    if (playerCloseBtn) {
        playerCloseBtn.addEventListener('click', () => {
            document.getElementById('playerOverlay').classList.remove('active');
            if (hlsPlayer) hlsPlayer.destroy();
            hlsPlayer = null;
            video.pause();
            video.src = '';
        });
    }
    if (manualRetryBtn) manualRetryBtn.addEventListener('click', () => { if (window.CHANNEL_DATA) window.initPlayerFromGlobal(); });

    // Video events
    video.addEventListener('play', () => { updatePlayPauseIcon(); wrapper.classList.remove('paused'); });
    video.addEventListener('pause', () => { updatePlayPauseIcon(); wrapper.classList.add('paused'); showControls(); });
    video.addEventListener('waiting', () => showLoading(true));
    video.addEventListener('playing', () => { showLoading(false); showError(false); });
    video.addEventListener('canplay', () => showLoading(false));
    video.addEventListener('volumechange', updateMuteUI);
    video.addEventListener('timeupdate', () => {
        if (isDVR) updateDVRProgress();
        else if (video.duration) {
            let percent = (video.currentTime / video.duration) * 100;
            if (progressPlayed) progressPlayed.style.width = percent + '%';
            if (progressHandle) progressHandle.style.left = percent + '%';
            if (currentTimeEl) currentTimeEl.textContent = formatTime(video.currentTime);
            if (totalTimeEl) totalTimeEl.textContent = formatTime(video.duration);
        }
    });

    // Auto-hide controls
    function showControls() {
        wrapper.classList.remove('autohide');
        clearTimeout(controlsTimeout);
        if (!video.paused) controlsTimeout = setTimeout(() => wrapper.classList.add('autohide'), 3000);
    }
    function hideControls() { if (video.paused) return; wrapper.classList.add('autohide'); }
    wrapper.addEventListener('mousemove', showControls);
    wrapper.addEventListener('touchstart', showControls);
    wrapper.addEventListener('mouseleave', () => { if (!video.paused) controlsTimeout = setTimeout(hideControls, 1000); });
    wrapper.addEventListener('click', (e) => { if (e.target === video || e.target === wrapper) togglePlay(); });
    wrapper.addEventListener('dblclick', (e) => { if (e.target === video || e.target === wrapper) toggleFullscreen(); });
    showControls();

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        switch (e.key.toLowerCase()) {
            case ' ': case 'k': e.preventDefault(); togglePlay(); break;
            case 'f': e.preventDefault(); toggleFullscreen(); break;
            case 'm': e.preventDefault(); video.muted = !video.muted; updateMuteUI(); break;
            case 'arrowup': e.preventDefault(); video.volume = Math.min(1, video.volume + 0.1); video.muted = false; updateMuteUI(); break;
            case 'arrowdown': e.preventDefault(); video.volume = Math.max(0, video.volume - 0.1); updateMuteUI(); break;
            case 'l': e.preventDefault(); seekToLive(); break;
            case 'escape': if (document.fullscreenElement) document.exitFullscreen(); break;
        }
    });

    // If CHANNEL_DATA is already set and overlay active (on page load if needed)
    if (window.CHANNEL_DATA && document.getElementById('playerOverlay').classList.contains('active')) {
        window.initPlayerFromGlobal();
    }
})();