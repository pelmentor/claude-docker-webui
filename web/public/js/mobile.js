// Mobile module — touch events, extra keys, PWA
(function () {
    'use strict';

    const ct = window.claudeTerminal;
    let ctrlActive = false;

    // --- Extra keys ---
    document.querySelectorAll('.extra-keys button').forEach((btn) => {
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();

            // Haptic feedback
            if (navigator.vibrate) navigator.vibrate(10);

            const key = btn.dataset.key;

            if (key === 'ctrl') {
                // Toggle Ctrl modifier
                ctrlActive = !ctrlActive;
                btn.classList.toggle('active', ctrlActive);
                return;
            }

            if (ctrlActive) {
                // Send Ctrl+key: for single printable chars, compute control code
                ctrlActive = false;
                document.querySelector('.extra-keys .modifier')?.classList.remove('active');

                if (key.length === 1 && key >= 'a' && key <= 'z') {
                    ct.sendKey(String.fromCharCode(key.charCodeAt(0) - 96));
                } else if (key.length === 1 && key >= 'A' && key <= 'Z') {
                    ct.sendKey(String.fromCharCode(key.charCodeAt(0) - 64));
                } else {
                    // For special keys, just send the key itself
                    ct.sendKey(key);
                }
            } else {
                ct.sendKey(key);
            }
        }, { passive: false });

        // Prevent default on mousedown too (desktop testing)
        btn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            const key = btn.dataset.key;

            if (key === 'ctrl') {
                ctrlActive = !ctrlActive;
                btn.classList.toggle('active', ctrlActive);
                return;
            }

            if (ctrlActive) {
                ctrlActive = false;
                document.querySelector('.extra-keys .modifier')?.classList.remove('active');
                if (key.length === 1) {
                    const code = key.toUpperCase().charCodeAt(0) - 64;
                    if (code > 0 && code < 27) {
                        ct.sendKey(String.fromCharCode(code));
                        return;
                    }
                }
            }
            ct.sendKey(key);
        });
    });

    // --- Touch gestures ---
    let touchStartX = 0;
    let touchStartY = 0;
    let longPressTimer = null;

    const termEl = document.getElementById('terminal');

    termEl.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;

        // Long press → paste
        longPressTimer = setTimeout(async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (text) {
                    ct.sendKey(text);
                    if (navigator.vibrate) navigator.vibrate(20);
                    Toast.success('Pasted');
                }
            } catch (e) {
                // Clipboard API may be denied
            }
        }, 500);
    }, { passive: true });

    termEl.addEventListener('touchmove', () => {
        clearTimeout(longPressTimer);
    });

    termEl.addEventListener('touchend', (e) => {
        clearTimeout(longPressTimer);

        if (e.changedTouches.length !== 1) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;

        // Swipe left → Escape
        if (dx < -80 && Math.abs(dy) < 40) {
            ct.sendKey('\x1b');
            if (navigator.vibrate) navigator.vibrate(10);
        }
    });

    // --- PWA service worker ---
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
})();
