(function() {
    const toastEl = document.getElementById('toast');
    let toastTimer;
    function showToast(msg, icon='info') {
        clearTimeout(toastTimer);
        toastEl.innerHTML = `<span class="material-icons-round">${icon}</span> ${msg}`;
        toastEl.classList.add('show');
        toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2500);
    }

    const ads = [
        { image: 'https://i.postimg.cc/kGmCkdn1/20260607-170253.png', text: 'Blue Sport' },
        { image: 'https://i.postimg.cc/dVNxgBLJ/20260603-150404.png', text: 'قنواتنا حصرياً' },
        { image: '', color: '#0d1b3e', text: 'تابع كل المباريات' }
    ];
    const adBanner = document.getElementById('adBanner');
    const adDotsContainer = document.getElementById('adDots');
    let currentAdIndex = 0, adInterval, slides = [];
    function createAdSlides() {
        adBanner.querySelectorAll('.ad-slide').forEach(s => s.remove());
        adDotsContainer.innerHTML = '';
        slides = [];
        ads.forEach((ad, idx) => {
            const slide = document.createElement('div'); slide.className = 'ad-slide';
            if(ad.image) slide.style.backgroundImage = `url('${ad.image}')`;
            else { slide.style.backgroundColor = ad.color; slide.textContent = ad.text; }
            adBanner.appendChild(slide); slides.push(slide);
            const dot = document.createElement('span'); dot.className = 'ad-dot'; dot.dataset.index = idx;
            dot.addEventListener('click', () => { goToSlide(idx); resetAdInterval(); });
            adDotsContainer.appendChild(dot);
        });
        goToSlide(0);
    }
    function goToSlide(idx) { slides.forEach((s,i)=>s.classList.toggle('active',i===idx)); adDotsContainer.querySelectorAll('.ad-dot').forEach((d,i)=>d.classList.toggle('active',i===idx)); currentAdIndex=idx; }
    function nextSlide() { goToSlide((currentAdIndex+1)%ads.length); }
    function resetAdInterval() { clearInterval(adInterval); adInterval = setInterval(nextSlide,5000); }

    const channels = [
        { id: 1, name: 'Blue Sport 1', image: 'https://i.postimg.cc/dVNxgBLJ/20260603-150404.png', streamUrl: 'https://bluesport.fun/live/blue_sport_1/index.m3u8', type: 'hls' },
        { id: 2, name: 'Blue Sport 2', image: 'https://i.postimg.cc/dVNxgBLJ/20260603-150404.png', streamUrl: 'https://bluesport.fun/live/blue_sport_2/index.m3u8', type: 'hls' },
        { id: 3, name: 'Blue Sport 3', image: 'https://i.postimg.cc/dVNxgBLJ/20260603-150404.png', streamUrl: 'https://bluesport.fun/live/blue_sport_3/index.m3u8', type: 'hls' }
    ];

    function renderChannels() {
        const grid = document.getElementById('channelsGrid');
        grid.innerHTML = channels.map(ch => `<a href="#" class="channel-card" data-id="${ch.id}"><img class="channel-image" src="${ch.image}" alt="${ch.name}"><div class="channel-gradient"></div><div class="channel-title">${ch.name}</div></a>`).join('');
        grid.querySelectorAll('.channel-card').forEach(card => {
            card.addEventListener('click', (e) => {
                e.preventDefault();
                const id = parseInt(card.dataset.id);
                const ch = channels.find(c=>c.id===id);
                if(ch) openPlayer(ch);
            });
        });
    }

    // دالة لمتابعة الـ redirects والحصول على الرابط النهائي
    async function resolveFinalUrl(url, maxRedirects = 5) {
        try {
            const response = await fetch(url, {
                method: 'HEAD',
                redirect: 'follow',
                mode: 'cors'
            });
            // بعد متابعة التوجيه، نأخذ الرابط النهائي من response.url
            return response.url;
        } catch (err) {
            console.warn('HEAD request failed, trying GET with no body', err);
            // بعض الخوادم لا تدعم HEAD، نستخدم GET ولكن بدون تحميل المحتوى
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000);
                const resp = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
                clearTimeout(timeoutId);
                return resp.url;
            } catch(e) {
                console.error('Failed to resolve redirect:', e);
                return url; // نرجع الرابط الأصلي كحل أخير
            }
        }
    }

    let currentHls = null, currentDash = null, isDVR = false, controlsTimeout = null;
    let currentChannel = null;
    const video = document.getElementById('videoPlayer');
    const loadingEl = document.getElementById('playerLoading');
    const resolvingMsg = document.getElementById('resolvingMsg');
    const errorEl = document.getElementById('playerError');
    const errorText = document.getElementById('playerErrorText');
    const playPauseBtn = document.getElementById('btnPlayPause');
    const muteBtn = document.getElementById('btnMute');
    const fullscreenBtn = document.getElementById('btnFullscreen');
    const qualityBtn = document.getElementById('btnQuality');
    const qualityDropdown = document.getElementById('qualityDropdown');
    const liveBtn = document.getElementById('btnLive');
    const volumeSlider = document.getElementById('volumeSlider');
    const progressWrapper = document.getElementById('progressWrapper');
    const progressPlayed = document.getElementById('progressPlayed');
    const progressBuffered = document.getElementById('progressBuffered');
    const progressHandle = document.getElementById('progressHandle');
    const currentTimeSpan = document.getElementById('currentTime');
    const totalTimeSpan = document.getElementById('totalTime');
    const qualityTracker = document.getElementById('qualityTracker');
    const playerWrapperDiv = document.getElementById('playerWrapper');
    const playerOverlay = document.getElementById('playerOverlay');
    const playerCloseBtn = document.getElementById('playerCloseBtn');
    const manualRetryBtn = document.getElementById('manualRetryBtn');

    function showLoading(show) { loadingEl.style.display = show ? 'flex' : 'none'; }
    function showResolving(show) { resolvingMsg.style.display = show ? 'block' : 'none'; }
    function showError(show, msg='') { errorEl.style.display = show ? 'flex' : 'none'; if(msg) errorText.innerText = msg; if(show) { showLoading(false); showResolving(false); } }
    function formatTime(sec) { if(isNaN(sec)) return '00:00'; sec=Math.floor(Math.abs(sec)); let m=Math.floor(sec/60), s=sec%60; if(m>=60) return `${Math.floor(m/60)}:${(m%60).toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`; return `${m}:${s.toString().padStart(2,'0')}`; }
    function updatePlayPauseIcon() { playPauseBtn.innerHTML = `<span class="material-icons-round">${video.paused ? 'play_arrow' : 'pause'}</span>`; }
    function updateMuteUI() { if(video.muted || video.volume===0) muteBtn.innerHTML='<span class="material-icons-round">volume_off</span>'; else if(video.volume<0.5) muteBtn.innerHTML='<span class="material-icons-round">volume_down</span>'; else muteBtn.innerHTML='<span class="material-icons-round">volume_up</span>'; if(volumeSlider) volumeSlider.value=video.muted?0:video.volume; }
    function updateProgress() {
        if(!video.duration) return;
        if(isDVR && video.seekable && video.seekable.length) {
            let start=video.seekable.start(0), end=video.seekable.end(0), dur=end-start, cur=video.currentTime-start, per=(cur/dur)*100;
            if(progressPlayed) progressPlayed.style.width=`${Math.min(per,100)}%`;
            if(progressHandle) progressHandle.style.left=`${Math.min(per,100)}%`;
            if(currentTimeSpan) currentTimeSpan.textContent=formatTime(cur);
            if(totalTimeSpan) totalTimeSpan.textContent=formatTime(dur);
            let atLive = (end - video.currentTime) < 5;
            if(liveBtn) { if(atLive) { liveBtn.classList.add('is-live'); liveBtn.textContent='مباشر'; } else { liveBtn.classList.remove('is-live'); liveBtn.textContent='العودة إلى المباشر'; } }
        } else {
            let per=(video.currentTime/video.duration)*100;
            if(progressPlayed) progressPlayed.style.width=`${per}%`;
            if(progressHandle) progressHandle.style.left=`${per}%`;
            if(currentTimeSpan) currentTimeSpan.textContent=formatTime(video.currentTime);
            if(totalTimeSpan) totalTimeSpan.textContent=formatTime(video.duration);
        }
    }
    function updateBufferedBar() {
        if(!isDVR && video.buffered.length) { let perc=(video.buffered.end(video.buffered.length-1)/video.duration)*100; if(progressBuffered) progressBuffered.style.width=`${Math.min(perc,100)}%`; }
        else if(isDVR && video.seekable && video.seekable.length && video.buffered.length) { let start=video.seekable.start(0), end=video.seekable.end(0), dur=end-start, buffEnd=video.buffered.end(video.buffered.length-1), perc=((buffEnd-start)/dur)*100; if(progressBuffered) progressBuffered.style.width=`${Math.min(perc,100)}%`; }
    }
    function seekToLive() { if(video.seekable && video.seekable.length) video.currentTime=video.seekable.end(0)-2; }
    function toggleFullscreen() { let elem=playerWrapperDiv; if(!document.fullscreenElement) { if(elem.requestFullscreen) elem.requestFullscreen(); else if(elem.webkitRequestFullscreen) elem.webkitRequestFullscreen(); } else { if(document.exitFullscreen) document.exitFullscreen(); } }
    function destroyPlayer() { 
        if(currentHls) { currentHls.destroy(); currentHls=null; } 
        if(currentDash) { currentDash.reset(); currentDash=null; } 
        video.pause(); 
        video.removeAttribute('src'); 
        video.load(); 
        isDVR=false; 
        if(liveBtn) liveBtn.style.display='none';
    }
    function setupQualityLevels(levels) {
        if(!levels || levels.length<=1) { qualityDropdown.style.display='none'; return; }
        let html='<button class="quality-option active" data-level="-1">تلقائي</button>';
        levels.forEach((lvl,idx)=>{ let label=lvl.height?`${lvl.height}p`:`جودة ${idx+1}`; html+=`<button class="quality-option" data-level="${idx}">${label}</button>`; });
        qualityDropdown.innerHTML=html;
        qualityDropdown.querySelectorAll('.quality-option').forEach(btn=>{ btn.addEventListener('click',()=>{ let level=parseInt(btn.dataset.level); if(currentHls) { currentHls.currentLevel=level; qualityTracker.textContent=btn.textContent; } qualityDropdown.querySelectorAll('.quality-option').forEach(o=>o.classList.remove('active')); btn.classList.add('active'); qualityDropdown.style.display='none'; }); });
    }
    function checkDVRSupport() {
        let interval=setInterval(()=>{ if(video.seekable && video.seekable.length && (video.seekable.end(0)-video.seekable.start(0))>15) { isDVR=true; if(liveBtn) liveBtn.style.display='inline-flex'; clearInterval(interval); } },1000);
        setTimeout(()=>clearInterval(interval),8000);
    }
    function initPlayerWithUrl(finalUrl) {
        destroyPlayer();
        showLoading(true);
        showError(false);
        if(Hls.isSupported()) {
            currentHls = new Hls({ maxBufferLength: 60, liveSyncDurationCount: 2, enableWorker: true });
            currentHls.loadSource(finalUrl);
            currentHls.attachMedia(video);
            currentHls.on(Hls.Events.MANIFEST_PARSED, (_,data)=>{ showLoading(false); video.play().catch(e=>console.log); setupQualityLevels(data.levels); checkDVRSupport(); });
            currentHls.on(Hls.Events.ERROR, (_,data)=>{ if(data.fatal) showError(true, 'فشل تشغيل البث النهائي'); });
        } else if(video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = finalUrl;
            video.addEventListener('loadedmetadata',()=>{ showLoading(false); video.play(); checkDVRSupport(); });
        } else showError(true, 'المتصفح لا يدعم HLS');
        video.addEventListener('timeupdate',()=>{ updateProgress(); updateBufferedBar(); });
        video.addEventListener('waiting',()=>showLoading(true));
        video.addEventListener('playing',()=>{ showLoading(false); showError(false); updatePlayPauseIcon(); });
        video.addEventListener('pause',updatePlayPauseIcon);
        video.addEventListener('volumechange',updateMuteUI);
        video.addEventListener('loadedmetadata',()=>{ updateProgress(); if(!isDVR) totalTimeSpan.textContent=formatTime(video.duration); });
    }
    async function openPlayer(channel) {
        currentChannel = channel;
        playerOverlay.classList.add('active');
        showLoading(false);
        showError(false);
        showResolving(true);
        try {
            const finalUrl = await resolveFinalUrl(channel.streamUrl);
            console.log('Final resolved URL:', finalUrl);
            showResolving(false);
            initPlayerWithUrl(finalUrl);
        } catch(err) {
            showResolving(false);
            showError(true, 'فشل في متابعة توجيه البث');
            console.error(err);
        }
        let showCtrl=()=>{ playerWrapperDiv.classList.remove('autohide'); clearTimeout(controlsTimeout); if(!video.paused) controlsTimeout=setTimeout(()=>playerWrapperDiv.classList.add('autohide'),3000); };
        playerWrapperDiv.addEventListener('mousemove',showCtrl);
        playerWrapperDiv.addEventListener('touchstart',showCtrl);
        showCtrl();
    }
    function closePlayer() { destroyPlayer(); playerOverlay.classList.remove('active'); if(document.fullscreenElement) document.exitFullscreen(); currentChannel=null; }
    function manualRetry() { if(currentChannel) openPlayer(currentChannel); }

    playPauseBtn.addEventListener('click',()=>{ video.paused ? video.play() : video.pause(); });
    muteBtn.addEventListener('click',()=>{ video.muted=!video.muted; });
    volumeSlider.addEventListener('input',(e)=>{ video.volume=parseFloat(e.target.value); video.muted=false; updateMuteUI(); });
    fullscreenBtn.addEventListener('click',toggleFullscreen);
    liveBtn.addEventListener('click',seekToLive);
    qualityBtn.addEventListener('click',(e)=>{ e.stopPropagation(); qualityDropdown.style.display = qualityDropdown.style.display==='none' ? 'flex' : 'none'; });
    document.addEventListener('click',()=>qualityDropdown.style.display='none');
    if(progressWrapper) progressWrapper.addEventListener('click',(e)=>{
        if(!video.duration && !isDVR) return;
        let rect=progressWrapper.getBoundingClientRect();
        let percent=(e.clientX-rect.left)/rect.width;
        percent=Math.min(1,Math.max(0,percent));
        if(isDVR && video.seekable && video.seekable.length) { let start=video.seekable.start(0), end=video.seekable.end(0); video.currentTime=start+(percent*(end-start)); }
        else video.currentTime=percent*video.duration;
    });
    playerCloseBtn.addEventListener('click',closePlayer);
    manualRetryBtn.addEventListener('click',manualRetry);

    const menuOverlayDiv = document.getElementById('menuOverlay');
    document.getElementById('menuToggle').addEventListener('click',()=>{ menuOverlayDiv.classList.add('active'); document.body.style.overflow='hidden'; });
    function closeMenu() { menuOverlayDiv.classList.remove('active'); document.body.style.overflow=''; }
    document.getElementById('menuCloseBtn').addEventListener('click',closeMenu);
    menuOverlayDiv.addEventListener('click',e=>{ if(e.target===menuOverlayDiv) closeMenu(); });
    document.querySelectorAll('.menu-link').forEach(l=>l.addEventListener('click',closeMenu));
    window.addEventListener('scroll',()=>{ let h=document.querySelector('header'); if(window.scrollY>10) h.classList.add('scrolled'); else h.classList.remove('scrolled'); });

    document.addEventListener('DOMContentLoaded',()=>{ createAdSlides(); resetAdInterval(); renderChannels(); });
})();