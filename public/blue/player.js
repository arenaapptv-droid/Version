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
    const progressBar = document.getElementById('progressBar');
    const progressPlayed = document.getElementById('progressPlayed');
    const progressBuffered = document.getElementById('progressBuffered');
    const progressHandle = document.getElementById('progressHandle');
    const currentTimeEl = document.getElementById('currentTime');
    const totalTimeEl = document.getElementById('totalTime');
    const qualityDropdown = document.getElementById('qualityDropdown');

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
    // Title Injection
    // ============================================
    (function() {
        const titleContainer = document.getElementById('dynamicTitleContainer');
        if (titleContainer && CHANNEL_DATA && CHANNEL_DATA.id) {
            const matchTitleKey = 'current_match_title_' + CHANNEL_DATA.id;
            const matchTitle = sessionStorage.getItem(matchTitleKey);
            
            if (matchTitle && matchTitle.includes(' ضد ')) {
                const parts = matchTitle.split(' ضد ');
                titleContainer.innerHTML = `
                <div class="player-match-title">
                    <span class="match-live-badge">مباشر</span>
                    <span class="match-team">${parts[0]}</span>
                    <span class="match-vs">ضد</span>
                    <span class="match-team">${parts[1]}</span>
                </div>
                `;
            }
            // Clear it so it doesn't stick permanently if the user accessed from somewhere else later
            sessionStorage.removeItem(matchTitleKey);
        }
    })();

    // ============================================
    // Initialize Player
    // ============================================
    function initPlayer() {
        const streamUrl = CHANNEL_DATA.streamUrl;
        const streamType = CHANNEL_DATA.type || 'hls';

        showLoading(true);
        showError(false);

        if (streamType === 'embed') {
            initEmbed(streamUrl);
        } else if (streamType === 'dash' || streamUrl.includes('.mpd')) {
            initDash(streamUrl);
        } else {
            initHLS(streamUrl);
        }
    }

    // ============================================
    // Embed Player (Iframe)
    // ============================================
    function initEmbed(url) {
        showLoading(false);
        const iframe = document.createElement('iframe');
        iframe.src = url;
        iframe.style.width = '100%';
        iframe.style.height = '100%';
        iframe.style.border = 'none';
        iframe.style.position = 'absolute';
        iframe.style.top = '0';
        iframe.style.left = '0';
        iframe.style.zIndex = '5';
        iframe.allowFullscreen = true;
        iframe.allow = "autoplay; fullscreen; encrypted-media; picture-in-picture";
        
        video.style.display = 'none';
        
        // Hide our custom video controls since we cannot control cross-origin iframes
        if (controls) controls.style.display = 'none';
        
        // Keep our watermark and allow clicks to pass through to iframe
        const watermark = document.getElementById('watermark');
        if (watermark) {
            watermark.style.zIndex = '10';
            watermark.style.pointerEvents = 'none';
        }
        
        const bannerAd = document.getElementById('playerBannerAd');
        if (bannerAd) bannerAd.style.zIndex = '15';
        
        wrapper.insertBefore(iframe, video);
    }

    // ============================================
    // HLS.js Player
    // ============================================
    function initHLS(url) {
        if (hlsPlayer) {
            hlsPlayer.destroy();
            hlsPlayer = null;
        }

        if (Hls.isSupported()) {
            hlsPlayer = new Hls({
                maxBufferLength: 60,
                maxMaxBufferLength: 600,
                backBufferLength: 90,
                liveSyncDurationCount: 2, // ~2 target segments behind live edge
                liveMaxLatencyDurationCount: 5,
                liveDurationInfinity: true,
                enableWorker: true,
                lowLatencyMode: true,
                xhrSetup: function(xhr) {
                    xhr.withCredentials = false;
                }
            });

            hlsPlayer.loadSource(url);
            hlsPlayer.attachMedia(video);

            hlsPlayer.on(Hls.Events.MANIFEST_PARSED, function(event, data) {
                showLoading(false);
                playVideo();
                setupQualityLevels(data.levels);
                checkDVRSupport();
            });

            hlsPlayer.on(Hls.Events.ERROR, function(event, data) {
                if (data.fatal) {
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            console.error('HLS Network Error:', data);
                            hlsPlayer.startLoad();
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.error('HLS Media Error:', data);
                            hlsPlayer.recoverMediaError();
                            break;
                        default:
                            showError(true, 'حدث خطأ في تحميل البث');
                            break;
                    }
                }
            });

            hlsPlayer.on(Hls.Events.LEVEL_SWITCHED, function(event, data) {
                updateQualityUI(data.level);
            });

            hlsPlayer.on(Hls.Events.FRAG_BUFFERED, function() {
                updateBuffered();
            });

        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            // Safari native HLS
            video.src = url;
            video.addEventListener('loadedmetadata', function() {
                showLoading(false);
                playVideo();
                checkDVRSupport();
            });
        } else {
            showError(true, 'المتصفح لا يدعم تشغيل HLS');
        }
    }

    // ============================================
    // DASH.js Player
    // ============================================
    function initDash(url) {
        if (dashPlayer) {
            dashPlayer.reset();
            dashPlayer = null;
        }

        if (typeof dashjs !== 'undefined') {
            dashPlayer = dashjs.MediaPlayer().create();
            dashPlayer.initialize(video, url, false);

            dashPlayer.updateSettings({
                streaming: {
                    lowLatencyEnabled: false,
                    buffer: {
                        fastSwitchEnabled: true
                    }
                }
            });

            dashPlayer.on(dashjs.MediaPlayer.events.STREAM_INITIALIZED, function() {
                showLoading(false);
                playVideo();
                setupDashQualities();
                checkDVRSupport();
            });

            dashPlayer.on(dashjs.MediaPlayer.events.ERROR, function(e) {
                console.error('DASH Error:', e);
                showError(true, 'حدث خطأ في تحميل البث');
            });
        } else {
            showError(true, 'مكتبة DASH غير محملة');
        }
    }

    // ============================================
    // Quality Levels
    // ============================================
    function setupQualityLevels(levels) {
        if (!qualityDropdown || !levels || levels.length <= 1) return;

        let html = '<button class="quality-option active" data-level="-1">تلقائي</button>';
        
        levels.forEach(function(level, index) {
            const height = level.height || '?';
            const bitrate = Math.round((level.bitrate || 0) / 1000);
            let label = height + 'p';
            if (height >= 1080) label = 'عالية (1080p)';
            else if (height >= 720) label = 'متوسطة (720p)';
            else if (height >= 480) label = 'منخفضة (480p)';
            
            html += '<button class="quality-option" data-level="' + index + '">' + label + '</button>';
        });

        qualityDropdown.innerHTML = html;

        qualityDropdown.querySelectorAll('.quality-option').forEach(function(btn) {
            btn.addEventListener('click', function() {
                const level = parseInt(this.dataset.level);
                if (hlsPlayer) {
                    hlsPlayer.currentLevel = level;
                }
                qualityDropdown.querySelectorAll('.quality-option').forEach(function(o) { o.classList.remove('active'); });
                const qualityTracker = document.getElementById('qualityTracker');
                if (qualityTracker) qualityTracker.textContent = this.textContent.split(' ')[0];
                this.classList.add('active');
                qualityDropdown.style.display = 'none';
            });
        });
    }

    function setupDashQualities() {
        if (!dashPlayer || !qualityDropdown) return;
        const qualities = dashPlayer.getBitrateInfoListFor('video');
        if (!qualities || qualities.length <= 1) return;

        let html = '<button class="quality-option active" data-level="-1">تلقائي</button>';
        
        qualities.forEach(function(q, i) {
            const label = (q.height || '?') + 'p';
            html += '<button class="quality-option" data-level="' + i + '">' + label + '</button>';
        });

        qualityDropdown.innerHTML = html;

        qualityDropdown.querySelectorAll('.quality-option').forEach(function(btn) {
            btn.addEventListener('click', function() {
                const level = parseInt(this.dataset.level);
                if (level === -1) {
                    dashPlayer.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: true } } } });
                } else {
                    dashPlayer.updateSettings({ streaming: { abr: { autoSwitchBitrate: { video: false } } } });
                    dashPlayer.setQualityFor('video', level);
                }
                qualityDropdown.querySelectorAll('.quality-option').forEach(function(o) { o.classList.remove('active'); });
                const qualityTracker = document.getElementById('qualityTracker');
                if (qualityTracker) qualityTracker.textContent = this.textContent;
                this.classList.add('active');
                qualityDropdown.style.display = 'none';
            });
        });
    }

    function updateQualityUI(level) {
        if (!qualityDropdown) return;
        // Auto mode active - no manual highlight needed
    }

    // ============================================
    // DVR / TimeShift (Source-based only)
    // ============================================
    function checkDVRSupport() {
        const progressRow = document.getElementById('progressRow');

        // Use timeupdate for smooth progress bar updates and checking stream capabilities
        video.addEventListener('timeupdate', function() {
            if (video.seekable && video.seekable.length > 0) {
                const start = video.seekable.start(0);
                const end = video.seekable.end(0);
                const duration = end - start;

                if (duration > 15) {
                    // Stream has enough buffer to be considered DVR
                    if (!isDVR) {
                        isDVR = true;
                        if (btnLive) btnLive.style.display = 'inline-flex';
                        if (progressRow) progressRow.style.display = 'flex';
                    }
                    updateDVRProgress();
                } else {
                    // Pure live, no seeking
                    if (isDVR) {
                        isDVR = false;
                        if (progressRow) progressRow.style.display = 'none';
                    }
                }
            }
        });
    }

    function updateDVRProgress() {
        if (!isDVR || !video.seekable || video.seekable.length === 0) return;

        const start = video.seekable.start(0);
        const end = video.seekable.end(0);
        const duration = end - start;
        const currentPos = video.currentTime - start;
        const percent = (currentPos / duration) * 100;

        if (progressPlayed) progressPlayed.style.width = Math.min(percent, 100) + '%';
        if (progressHandle) {
            progressHandle.style.left = Math.min(percent, 100) + '%';
        }

        // Check if at live edge (within 5 seconds tolerance)
        const liveThreshold = 5;
        isAtLiveEdge = (end - video.currentTime) < liveThreshold;

        if (btnLive) {
            if (isAtLiveEdge) {
                btnLive.classList.add('is-live');
                btnLive.innerHTML = 'مباشر';
            } else {
                btnLive.classList.remove('is-live');
                btnLive.innerHTML = 'العودة الى البث المباشر';
            }
        }

        // Update time display
        if (currentTimeEl) {
            currentTimeEl.textContent = formatTime(currentPos);
        }
        if (totalTimeEl) {
            totalTimeEl.textContent = formatTime(duration);
        }
    }

    function seekToLive() {
        if (video.seekable && video.seekable.length > 0) {
            // Give 2 seconds buffer from the absolute end to prevent instant stalling
            video.currentTime = Math.max(video.seekable.end(0) - 2, video.seekable.start(0));
            isAtLiveEdge = true;
        }
    }

    // ============================================
    // Progress Bar Interaction (DVR seeking)
    // ============================================
    if (progressWrapper) {
        let isSeeking = false;

        progressWrapper.addEventListener('mousedown', function(e) {
            if (!isDVR) return;
            isSeeking = true;
            seekFromEvent(e);
        });

        document.addEventListener('mousemove', function(e) {
            if (!isSeeking) return;
            seekFromEvent(e);
        });

        document.addEventListener('mouseup', function() {
            isSeeking = false;
        });

        // Touch support
        progressWrapper.addEventListener('touchstart', function(e) {
            if (!isDVR) return;
            isSeeking = true;
            seekFromEvent(e.touches[0]);
        });

        document.addEventListener('touchmove', function(e) {
            if (!isSeeking) return;
            seekFromEvent(e.touches[0]);
        });

        document.addEventListener('touchend', function() {
            isSeeking = false;
        });

        function seekFromEvent(e) {
            if (!video.seekable || video.seekable.length === 0) return;

            const rect = progressBar.getBoundingClientRect();
            // LTR Progress bar calculation
            const percent = (e.clientX - rect.left) / rect.width;
            const clampedPercent = Math.max(0, Math.min(1, percent));

            const start = video.seekable.start(0);
            const end = video.seekable.end(0);
            const duration = end - start;
            const seekTime = start + (clampedPercent * duration);

            video.currentTime = seekTime;
        }
    }

    // ============================================
    // Buffered Progress
    // ============================================
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

    // ============================================
    // Controls: Play/Pause
    // ============================================
    if (btnPlayPause) {
        btnPlayPause.addEventListener('click', togglePlay);
    }

    // Skip buttons removed per user request

    wrapper.addEventListener('click', function(e) {
        // Prevent click if clicking on buttons or interactive areas
        if (e.target.closest('.player-btn') || e.target.closest('.skip-btn') || e.target.closest('.quality-pill') || e.target.closest('.quality-dropdown') || e.target.closest('.volume-wrapper') || e.target.closest('.player-progress-wrapper') || e.target.closest('.player-live-btn') || e.target.closest('.player-top-bar') || e.target.closest('.player-actions-row')) return;
        if (e.target === video || e.target === wrapper || e.target.closest('.player-center-icon')) {
            togglePlay();
        }
    });

    // Double click for fullscreen
    wrapper.addEventListener('dblclick', function(e) {
        if (e.target === video || e.target === wrapper) {
            toggleFullscreen();
        }
    });

    function togglePlay() {
        if (adPlaying) return;
        if (video.paused) {
            playVideo();
            wrapper.classList.remove('paused');
        } else {
            video.pause();
            wrapper.classList.add('paused');
        }
    }

    function playVideo() {
        const promise = video.play();
        if (promise) {
            promise.catch(function(err) {
                // Autoplay blocked, wait for user interaction
                console.log('Autoplay prevented:', err);
                video.muted = true;
                const mutedPromise = video.play();
                if (mutedPromise) {
                    mutedPromise.then(() => {
                        updateMuteUI();
                        wrapper.classList.remove('paused');
                    }).catch((e) => {
                        console.log('Muted autoplay also prevented', e);
                        wrapper.classList.add('paused');
                    });
                }
            });
        }
    }

    video.addEventListener('play', function() {
        if (btnPlayPause) btnPlayPause.innerHTML = '<i class="ph-fill ph-pause"></i>';
        wrapper.classList.remove('paused');
        wrapper.classList.add('playing');
    });

    video.addEventListener('pause', function() {
        if (btnPlayPause) btnPlayPause.innerHTML = '<i class="ph-fill ph-play"></i>';
        wrapper.classList.add('paused');
        wrapper.classList.remove('playing');
        showControls();
    });

    video.addEventListener('waiting', function() {
        showLoading(true);
    });

    video.addEventListener('playing', function() {
        showLoading(false);
        showError(false);
    });

    video.addEventListener('canplay', function() {
        showLoading(false);
    });

    // ============================================
    // Controls: Volume
    // ============================================
    if (btnMute) {
        btnMute.addEventListener('click', function() {
            video.muted = !video.muted;
            updateMuteUI();
        });
    }

    if (volumeSlider) {
        volumeSlider.addEventListener('input', function() {
            video.volume = this.value;
            video.muted = this.value == 0;
            updateMuteUI();
        });
    }

    function updateMuteUI() {
        if (!btnMute) return;
        if (video.muted || video.volume === 0) {
            btnMute.innerHTML = '<i class="ph ph-speaker-slash"></i>';
        } else if (video.volume < 0.5) {
            btnMute.innerHTML = '<i class="ph ph-speaker-low"></i>';
        } else {
            btnMute.innerHTML = '<i class="ph ph-speaker-high"></i>';
        }
        if (volumeSlider) {
            volumeSlider.value = video.muted ? 0 : video.volume;
        }
    }

    // ============================================
    // Controls: Fullscreen
    // ============================================
    if (btnFullscreen) {
        btnFullscreen.addEventListener('click', toggleFullscreen);
    }

    function toggleFullscreen() {
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
            if (wrapper.requestFullscreen) {
                wrapper.requestFullscreen();
            } else if (wrapper.webkitRequestFullscreen) {
                wrapper.webkitRequestFullscreen();
            } else if (wrapper.msRequestFullscreen) {
                wrapper.msRequestFullscreen();
            } else if (video.webkitEnterFullscreen) {
                video.webkitEnterFullscreen(); // iOS
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            }
        }
    }

    document.addEventListener('fullscreenchange', updateFullscreenUI);
    document.addEventListener('webkitfullscreenchange', updateFullscreenUI);

    function updateFullscreenUI() {
        const isFS = document.fullscreenElement || document.webkitFullscreenElement;
        if (btnFullscreen) {
            btnFullscreen.innerHTML = isFS ? '<i class="ph ph-corners-in"></i>' : '<i class="ph ph-corners-out"></i>';
        }
    }

    // ============================================
    // Controls: Live Button
    // ============================================
    if (btnLive) {
        btnLive.addEventListener('click', function() {
            seekToLive();
        });
    }



    // ============================================
    // Controls: Quality Menu
    // ============================================
    if (btnQuality && qualityDropdown) {
        btnQuality.addEventListener('click', function(e) {
            e.stopPropagation();
            qualityDropdown.style.display = qualityDropdown.style.display === 'none' ? 'block' : 'none';
        });

        document.addEventListener('click', function() {
            qualityDropdown.style.display = 'none';
        });
    }

    // ============================================
    // Controls: LIVE Button
    // ============================================
    if (btnLive) {
        btnLive.addEventListener('click', function() {
            seekToLive();
        });
    }

    // ============================================
    // Controls: Auto-hide
    // ============================================
    function showControls() {
        wrapper.classList.remove('autohide');
        wrapper.style.cursor = 'default';
        clearTimeout(controlsTimeout);
        if (!video.paused) {
            controlsTimeout = setTimeout(hideControls, 3000);
        }
    }

    function hideControls() {
        if (video.paused) return;
        wrapper.classList.add('autohide');
        wrapper.style.cursor = 'none';
    }

    wrapper.addEventListener('mousemove', showControls);
    wrapper.addEventListener('touchstart', showControls);
    wrapper.addEventListener('mouseleave', function() {
        if (!video.paused) {
            controlsTimeout = setTimeout(hideControls, 1000);
        }
    });
    
    // Initial state
    wrapper.classList.add('paused');
    showControls();


    // ============================================
    // Keyboard Shortcuts
    // ============================================
    document.addEventListener('keydown', function(e) {
        // Don't trigger if typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch (e.key.toLowerCase()) {
            case ' ':
            case 'k':
                e.preventDefault();
                togglePlay();
                break;
            case 'f':
                e.preventDefault();
                toggleFullscreen();
                break;
            case 'm':
                e.preventDefault();
                video.muted = !video.muted;
                updateMuteUI();
                break;
            case 'arrowup':
                e.preventDefault();
                video.volume = Math.min(1, video.volume + 0.1);
                video.muted = false;
                updateMuteUI();
                break;
            case 'arrowdown':
                e.preventDefault();
                video.volume = Math.max(0, video.volume - 0.1);
                updateMuteUI();
                break;
            case 'l':
                e.preventDefault();
                seekToLive();
                break;
            case 'escape':
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                }
                break;
        }
    });

    // ============================================
    // Helpers
    // ============================================
    function showLoading(show) {
        if (loading) loading.style.display = show ? 'flex' : 'none';
    }

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

    // ============================================
    // Retry
    // ============================================
    window.retryStream = function() {
        initPlayer();
    };

    // ============================================
    // Pre-roll Ad System
    // ============================================
    function handlePrerollAd() {
        const adOverlay = document.getElementById('adOverlay');
        const adVideo = document.getElementById('adVideo');
        const adSkip = document.getElementById('adSkip');
        const adTimer = document.getElementById('adTimer');

        if (!adOverlay || !adVideo || !ADS_CONFIG || !ADS_CONFIG.preroll || !ADS_CONFIG.preroll.enabled) {
            // No ad, init player directly
            initPlayer();
            return;
        }

        adPlaying = true;
        const skipAfter = ADS_CONFIG.preroll.skip_after || 5;

        adVideo.play().catch(function() {
            // Autoplay blocked, skip ad
            adOverlay.style.display = 'none';
            adPlaying = false;
            initPlayer();
        });

        adVideo.addEventListener('playing', function() {
            if (adTimer) {
                adTimer.classList.add('is-playing');
            }
        });

        adVideo.addEventListener('timeupdate', function() {
            if (isNaN(adVideo.duration)) return;
            const remaining = Math.ceil(adVideo.duration - adVideo.currentTime);
            if (adTimer) adTimer.textContent = remaining + ' ثانية';

            if (adVideo.currentTime >= skipAfter && adSkip) {
                adSkip.style.display = 'inline-flex';
            }
        });

        adVideo.addEventListener('ended', function() {
            adOverlay.style.display = 'none';
            adPlaying = false;
            initPlayer();
        });
    }

    window.skipAd = function() {
        const adOverlay = document.getElementById('adOverlay');
        const adVideo = document.getElementById('adVideo');
        if (adVideo) adVideo.pause();
        if (adOverlay) adOverlay.style.display = 'none';
        adPlaying = false;
        initPlayer();
    };

    // ============================================
    // Start
    // ============================================
    handlePrerollAd();

})();
