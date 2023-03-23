// ==UserScript==
// @name         Better Portal
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Better Management!
// @author       DanPlayz
// @match        https://geffenacademy.myschoolapp.com/app/student
// @icon         https://www.google.com/s2/favicons?sz=64&domain=myschoolapp.com
// @grant        none
// ==/UserScript==

(async function () {
    'use strict';
    function waitForElm(selector) {
        return new Promise(resolve => {
            if (document.querySelector(selector)) {
                return resolve(document.querySelector(selector));
            }

            const observer = new MutationObserver(mutations => {
                if (document.querySelector(selector)) {
                    resolve(document.querySelector(selector));
                    observer.disconnect();
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        });
    }

    // Speed up logins
    if (window.location == "https://geffenacademy.myschoolapp.com/app#login" || window.location == "https://geffenacademy.myschoolapp.com/app/student#login") {
        await waitForElm("#Username");
        await new Promise(resolve => setTimeout(resolve, 3000));
        if (document.getElementById("Username").value != "") {
            window.location.replace("https://signin.blackbaud.com/signin/?redirectUrl=https:%2F%2Fgeffenacademy.myschoolapp.com%2Fapp%3Fbb_id%3D1%23login&login_hint=betterportal@geffenacademy.ucla.edu");
        }
    }

    let lastPagePath = null, lastPageHash = null;
    let pageUpdate = null, events = [];
    let portalContext = null;
    let getSetting = (key) => {
        if (!chrome.hasOwnProperty('storage')) {
            const settings = {
                "sortby": "none",
            }
            return settings[key];
        }
        return new Promise((resolve, reject) => {
            chrome.storage.sync.get(key, (items) => {
                resolve(items[key]);
            });
        });
    };
    setInterval(async () => {
        if (lastPagePath == window.location.pathname && lastPageHash == window.location.hash) return;
        lastPagePath = window.location.pathname;
        lastPageHash = window.location.hash;
        clearInterval(pageUpdate);
        events.map((x) => document.body.removeEventListener(x[0], x[1]));
        events = [];
        if (lastPagePath != "/app" && lastPageHash != "#login") portalContext = await fetch(`https://geffenacademy.myschoolapp.com/api/webapp/context?_=${Date.now()}`).then(res => res.json());

        if (lastPagePath == "/app/student" && lastPageHash == "#studentmyday/assignment-center") {
            await waitForElm("tbody#assignment-center-assignment-items>tr");
            let hiddenAssignments = JSON.parse(window.localStorage.getItem('betterportal-hidden-assignments') ?? "[]");
            let pinnedAssignments = JSON.parse(window.localStorage.getItem('betterportal-pinned-assignments') ?? "[]");
            pageUpdate = setInterval(() => {
                const assignments = [...document.querySelector("tbody#assignment-center-assignment-items").children];
                for (let elm of assignments) {
                    if (elm.children[1].innerText == "My tasks") continue;
                    let assignmentId = elm.children[5].children[0].children[0].children[0].dataset.id,
                        [_, assignmentIndexId] = elm.children[2].children[0].href.replace(/^.+#/, '#').match(/#assignmentdetail\/\d+\/(\d+)/);

                    // Hide Assignment (Function)
                    if (hiddenAssignments.includes(assignmentId)) {
                        elm.remove();
                        continue;
                    }

                    // No "Overdue" Red
                    if (elm.children[5].innerText.includes("Overdue") && !elm.children[5].children[0].children[0].children[0].className.includes('betterportal-no-danger')) {
                        elm.children[5].children[0].children[0].children[0].classList.add('betterportal-no-danger');
                        elm.children[5].children[0].children[0].children[0].classList.remove('label-danger');
                    }

                    // Hide Assignment (Button)
                    if (!elm.children[6].innerHTML.includes("betterportal-hide-assignment")) {
                        if (elm.children[6].innerText == "Submit") elm.children[6].innerHTML += `<br/>`;
                        elm.children[6].innerHTML += `<button data-id="${assignmentId}" class="btn btn-link betterportal-hide-assignment" style="padding-left:0px;">Hide</button>`;
                    }

                    // Pin Assignment (Button)
                    if (!elm.children[6].innerHTML.includes("betterportal-pin-assignment") && !elm.children[6].innerHTML.includes("betterportal-unpin-assignment")) {
                        let isPinned = pinnedAssignments.some(x => x.id == assignmentId);
                        if (isPinned) elm.children[6].innerHTML += `<button data-id="${assignmentId}" class="btn btn-link betterportal-unpin-assignment" style="margin-left:10px;">Unpin</button>`;
                        else elm.children[6].innerHTML += `<button data-id="${assignmentId}" class="btn btn-link betterportal-pin-assignment" style="margin-left:10px;">Pin</button>`;
                    }

                    // Clickable "Graded"
                    if (elm.children[5].innerText.includes("Graded") && !elm.children[5].children[0].children[0].children[0].className.includes('betterportal-graded-clickable')) {
                        elm.children[5].children[0].children[0].children[0].classList.add('betterportal-graded-clickable');
                    }


                    // Has Saved Notes
                    const assignmentNotes = localStorage.getItem(`betterportal-si-${assignmentId}_${assignmentIndexId}`);
                    if (assignmentNotes && !elm.children[2].innerHTML.includes('betterportal-savednotes')) {
                        elm.children[2].innerHTML += `<p class="betterportal-savednotes" style="margin:-2px 0px 0px 0px; font-size:11px; color:#700">Has Saved Notes</p>`
                    }
                }
            }, 50);

            if ((await getSetting("sortby")) != "none") {
                var clickEvent = document.createEvent("MouseEvents");
                clickEvent.initEvent("click", true, true);
                document.querySelector(`[data-sort="${await getSetting("sortby")}"]`).dispatchEvent(clickEvent);
            }

            const assignmentHeaderViewAdd = (prepend = true, html) => {
                if (!html) throw Error("No HTML Provided! (assignmentHeaderViewAdd)");
                const assignmentHeaderView = document.querySelector("#assignment-center-header-view .pull-right.assignment-calendar-button-bar");
                if (assignmentHeaderView) {
                    if (prepend) assignmentHeaderView.innerHTML = html + assignmentHeaderView.innerHTML;
                    else assignmentHeaderView.innerHTML += html;
                }
            };
            if (localStorage.getItem("betterportal-hidden-assignments")) {
                assignmentHeaderViewAdd(true, `<button id="betterportal-unhide-all" class="btn btn-default btn-sm" data-toggle="modal"><i class="fa fa-eye"></i> Unhide All</button>`);
            }

            events.push(['click', (e) => {
                if (e.srcElement.className.includes("betterportal-hide-assignment")) {
                    hiddenAssignments.push(e.srcElement.dataset.id);
                    e.srcElement.parentElement.parentElement.remove();
                    window.localStorage.setItem("betterportal-hidden-assignments", JSON.stringify(hiddenAssignments))
                    if (!document.querySelector("#betterportal-unhide-all")) {
                        assignmentHeaderViewAdd(true, `<button id="betterportal-unhide-all" class="btn btn-default btn-sm" data-toggle="modal"><i class="fa fa-eye"></i> Unhide All</button>`);
                    }
                } else if (e.srcElement.id == "betterportal-unhide-all") {
                    hiddenAssignments = [];
                    localStorage.removeItem("betterportal-hidden-assignments");
                    document.querySelector("#betterportal-unhide-all")?.remove();
                    window.location.reload(); // Todo, Make this not reload the page.
                } else if (e.srcElement.className.includes("betterportal-pin-assignment")) {
                    let assignmentElm = e.srcElement.parentElement.parentElement;
                    assignmentElm.children[6].innerHTML = assignmentElm.children[6].innerHTML.replace("betterportal-pin-assignment", "betterportal-unpin-assignment").replace("Pin", "Unpin");
                    pinnedAssignments.push({
                        id: e.srcElement.dataset.id,
                        link: assignmentElm.children[2].children[0].href,
                    });
                    window.localStorage.setItem("betterportal-pinned-assignments", JSON.stringify(pinnedAssignments));
                } else if (e.srcElement.className.includes("betterportal-unpin-assignment")) {
                    let assignmentElm = e.srcElement.parentElement.parentElement;
                    assignmentElm.children[6].innerHTML = assignmentElm.children[6].innerHTML.replace("betterportal-unpin-assignment", "betterportal-pin-assignment").replace("Unpin", "Pin");
                    pinnedAssignments = pinnedAssignments.filter(x => x.id != e.srcElement.dataset.id);
                    if (pinnedAssignments.length == 0) localStorage.removeItem("betterportal-pinned-assignments");
                    else window.localStorage.setItem("betterportal-pinned-assignments", JSON.stringify(pinnedAssignments));
                }
            }]);
            const assignments = [...document.querySelector("tbody#assignment-center-assignment-items").children];
            console.log("Assignments Loaded!", assignments.length);
        } else if (lastPagePath == "/app/student" && lastPageHash.startsWith("#assignmentdetail/")) {
            await waitForElm("div#assignment-detail-assignment .bb-tile-content-section");
            const [_, assignmentId, assignmentIndexId] = lastPageHash.match(/#assignmentdetail\/(\d+)\/(\d+)/);
            if (!document.querySelector("#betterportal-text-content")) {
                document.querySelector("#assignment-detail-assignment .bb-tile-content-section").innerHTML += `<div id="betterportal-text-content">
  <div class="well well-sm" style="margin:10px 0px 5px 0px">
    <h3>Saved Notes</h3>
    <textarea id="betterportal-savedinfo" style="min-height:100px;width:100%;resize:vertical;"></textarea>
  </div>
</div>`;
            }
            document.querySelector("#betterportal-text-content textarea").value = localStorage.getItem(`betterportal-si-${assignmentId}_${assignmentIndexId}`) ?? "";
            events.push(['input', (e) => {
                if (e.srcElement.id == "betterportal-savedinfo") {
                    if (e.srcElement.value.length == 0) localStorage.removeItem(`betterportal-si-${assignmentId}_${assignmentIndexId}`);
                    else localStorage.setItem(`betterportal-si-${assignmentId}_${assignmentIndexId}`, e.srcElement.value);
                }
            }])
        }
        events.map((x) => document.body.addEventListener(x[0], x[1]));
    }, 25);
})();
