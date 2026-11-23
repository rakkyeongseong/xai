/* Small progressive enhancements for the archive pages.
   Everything here is optional — the site works with JavaScript disabled. */
(function () {
    "use strict";

    /* Jumping to a year that sits inside a collapsed <details> should open it. */
    function revealTarget(hash, scroll) {
        if (!hash || hash.length < 2) return;
        var target;
        try {
            target = document.querySelector(hash);
        } catch (e) {
            return;
        }
        if (!target) return;
        var node = target;
        while (node) {
            if (node.tagName === "DETAILS") node.open = true;
            node = node.parentElement;
        }
        if (scroll) {
            window.requestAnimationFrame(function () {
                target.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        }
    }

    document.addEventListener("click", function (event) {
        var link = event.target.closest ? event.target.closest('a[href^="#"]') : null;
        if (!link) return;
        var hash = link.getAttribute("href");
        if (hash === "#" || !document.querySelector(hash)) return;
        event.preventDefault();
        revealTarget(hash, true);
        if (window.history && window.history.replaceState) {
            window.history.replaceState(null, "", hash);
        }
    });

    window.addEventListener("hashchange", function () {
        revealTarget(window.location.hash, true);
    });

    revealTarget(window.location.hash, false);

    /* news-render.js calls this once the archive has been built from news.json */
    window.SiteNav = { revealTarget: revealTarget };
})();

/* Photo viewer for photos.html.
   Every thumbnail in an album is an ordinary link to the full photo. Here that
   link is taken over: the photo opens in an overlay with previous / next
   (buttons, arrow keys, swipe) instead of a new tab. Without JavaScript, or in
   a browser without <dialog>, the link simply opens the image. */
(function () {
    "use strict";

    if (!window.HTMLDialogElement || typeof window.HTMLDialogElement.prototype.showModal !== "function") return;

    var ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="';
    var dialog = null, stage, image, caption, details, counter, prevButton, nextButton;
    var links = [], index = 0, ticket = 0, touchX = null, touchY = null;

    function button(cls, label, path) {
        return '<button type="button" class="lightbox__btn ' + cls + '" aria-label="' + label + '">' +
            ICON + path + '"/></svg></button>';
    }

    function build() {
        dialog = document.createElement("dialog");
        dialog.className = "lightbox";
        dialog.setAttribute("aria-label", "Photo viewer");
        dialog.innerHTML =
            button("lightbox__close", "Close photo viewer", "M6 6l12 12M18 6L6 18") +
            '<div class="lightbox__stage">' +
            button("lightbox__prev", "Previous photo", "M15 5l-7 7 7 7") +
            '<img class="lightbox__img" alt="">' +
            button("lightbox__next", "Next photo", "M9 5l7 7-7 7") +
            "</div>" +
            '<div class="lightbox__bar" aria-live="polite">' +
            '<p class="lightbox__caption"></p><p class="lightbox__details"></p>' +
            '<p class="lightbox__count"></p></div>';
        document.body.appendChild(dialog);

        stage = dialog.querySelector(".lightbox__stage");
        image = dialog.querySelector(".lightbox__img");
        caption = dialog.querySelector(".lightbox__caption");
        details = dialog.querySelector(".lightbox__details");
        counter = dialog.querySelector(".lightbox__count");
        prevButton = dialog.querySelector(".lightbox__prev");
        nextButton = dialog.querySelector(".lightbox__next");

        dialog.querySelector(".lightbox__close").addEventListener("click", closeViewer);
        prevButton.addEventListener("click", function () { show(index - 1); });
        nextButton.addEventListener("click", function () { show(index + 1); });

        /* a click beside the photo closes the viewer */
        dialog.addEventListener("click", function (event) {
            if (event.target === dialog || event.target === stage ||
                    (event.target === image && !insidePhoto(event))) {
                closeViewer();
            }
        });

        dialog.addEventListener("keydown", function (event) {
            if (event.altKey || event.ctrlKey || event.metaKey || links.length < 2) return;
            if (event.key === "ArrowLeft") { event.preventDefault(); show(index - 1); }
            if (event.key === "ArrowRight") { event.preventDefault(); show(index + 1); }
        });

        stage.addEventListener("touchstart", function (event) {
            var touch = event.touches.length === 1 ? event.touches[0] : null;
            touchX = touch ? touch.clientX : null;
            touchY = touch ? touch.clientY : null;
        }, { passive: true });

        stage.addEventListener("touchend", function (event) {
            if (touchX === null || links.length < 2) return;
            var touch = event.changedTouches[0];
            var dx = touch.clientX - touchX, dy = touch.clientY - touchY;
            touchX = null;
            if (Math.abs(dx) > 48 && Math.abs(dx) > 1.5 * Math.abs(dy)) show(index + (dx < 0 ? 1 : -1));
        }, { passive: true });

        /* the Escape key closes the dialog by itself and only reports it here */
        dialog.addEventListener("close", tidy);
    }

    /* after closing: release the page and put the focus on the thumbnail of the
       photo that was showing. Safe to call twice. */
    function tidy() {
        if (!links.length) return;
        var last = links[index];
        links = [];
        ticket += 1;
        document.documentElement.classList.remove("has-lightbox");
        image.removeAttribute("src");
        if (last && last.focus) last.focus();
    }

    function closeViewer() {
        if (dialog.open) dialog.close();
        tidy();
    }

    /* the <img> fills the stage; the photo itself is letterboxed inside it */
    function insidePhoto(event) {
        var box = image.getBoundingClientRect();
        var w = image.naturalWidth, h = image.naturalHeight;
        if (!w || !h) return true;
        var scale = Math.min(box.width / w, box.height / h, 1);
        var marginX = (box.width - w * scale) / 2, marginY = (box.height - h * scale) / 2;
        var x = event.clientX - box.left, y = event.clientY - box.top;
        return x >= marginX && x <= box.width - marginX && y >= marginY && y <= box.height - marginY;
    }

    function show(position) {
        index = (position + links.length) % links.length;
        var link = links[index];
        var thumb = link.querySelector("img");
        var mine = ++ticket;
        var done = function () {
            if (mine === ticket) dialog.classList.remove("is-loading");
        };
        dialog.classList.add("is-loading");
        image.onload = done;
        image.onerror = done;
        image.alt = thumb ? thumb.alt : "";
        image.src = link.href;
        counter.textContent = (index + 1) + " / " + links.length;
        prevButton.hidden = nextButton.hidden = links.length < 2;
        if (links.length > 1) new Image().src = links[(index + 1) % links.length].href;
    }

    /* every photo of an album has the same caption: the album's title, the
       dates of the event and a link to its website (content-render.js puts
       them on the album's grid as data-title, data-dates and data-website) */
    function describe(album) {
        var get = function (name) { return (album.getAttribute && album.getAttribute(name)) || ""; };
        caption.textContent = get("data-title");
        details.textContent = get("data-dates");
        var url = get("data-website");
        if (/^https?:\/\//i.test(url)) {
            if (details.textContent) details.appendChild(document.createTextNode(" \u00B7 "));
            var link = document.createElement("a");
            link.className = "lightbox__link";
            link.href = url;
            link.target = "_blank";
            link.rel = "noopener";
            link.textContent = get("data-website-label") || "Website";
            details.appendChild(link);
        }
    }

    function open(link) {
        if (!dialog) build();
        var album = link.closest(".album__grid") || document;
        links = Array.prototype.slice.call(album.querySelectorAll("a.album__photo"));
        describe(album);
        document.documentElement.classList.add("has-lightbox");
        show(Math.max(links.indexOf(link), 0));
        dialog.showModal();
    }

    document.addEventListener("click", function (event) {
        if (event.defaultPrevented || event.button !== 0 ||
                event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        var link = event.target.closest ? event.target.closest("a.album__photo") : null;
        if (!link) return;
        event.preventDefault();
        open(link);
    });
})();
