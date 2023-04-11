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

let portalContext = null;
let lastPagePath = null, lastPageHash = null;
let pageUpdate = null, events = [];

const defaultSettings = {
    "sortby": "none", // none, groupname, assignment_type, short_description, date_assigned, date_due, assignment_status
    "sortdir": "asc", // asc, des
    "showbuttons": true,
    "overduecolor": null, // none, hexcode (e.g. #ff0000)

    "savednotes": true,
    "classlinks": true,
};

class CacheMap {
    constructor() {
        this.cache = new Map();
        this.expires = new Map();
    }

    set(key, value) {
        this.cache.set(key, value);
    }

    setex(key, value, seconds) {
        this.cache.set(key, value);
        this.expires.set(key, Date.now() + 1000 * seconds);
    }

    get(key) {
        if (this.cache.has(key) && this.expires.get(key) > Date.now()) return this.cache.get(key);
        return null;
    }

    has(key) {
        return this.cache.has(key) && this.expires.get(key) > Date.now();
    }

    delete(key) {
        this.cache.delete(key);
        this.expires.delete(key);
    }

    clear() {
        this.cache.clear();
        this.expires.clear();
    }
}

class ChromeMap extends CacheMap {
    constructor() {
        super();
        this.errored = false;
    }

    reset() {
        if (this.errored) return;
        this.errored = true;
    }

    get(key) {
        if (this.cache.has(key) && this.expires.get(key) > Date.now()) return this.cache.get(key);
        if (!chrome.hasOwnProperty('storage')) return settings[key];
        const thisClass = this;
        return new Promise((resolve) => {
            try {
                chrome.storage.sync.get(key, (items) => {
                    thisClass.cache.set(key, items[key] ?? defaultSettings[key]);
                    thisClass.expires.set(key, Date.now() + 1000 * 5);
                    resolve(items[key] ?? defaultSettings[key]);
                });
            } catch (err) {
                console.error(err);
                if (err.message == "Extension context invalidated.") {
                    this.get = this.reset;
                }
                resolve(defaultSettings[key]);
            }
        });
    }
}
const settingsCache = new CacheMap();

class PerisistentMap {
    constructor() {
        this.portalContext = null;
        this.auth = null;
        this.useLocal = localStorage.getItem('useLocal') ?? false;
        this.baseURL = 'https://danny.divinsky.com/api/betterportal';
        this.cache = {};
        this.authGenAttempts = 0;
    }

    $fetch(url, options) {
        const xhr = new XMLHttpRequest();
        xhr.open(options.method, url);
        for (const [key, value] of Object.entries(options.headers)) xhr.setRequestHeader(key, value);
        if(options.method != "GET") xhr.send(options.body);
        return new Promise((resolve, reject) => {
            xhr.onload = () => {
                if (xhr.getResponseHeader('Content-Type').startsWith('application/json')) resolve(JSON.parse(xhr.responseText));
                else resolve(xhr.responseText);
            };
            xhr.onerror = () => reject(xhr.statusText);
        });
    }
 
    $genAuth() {
        if (this.auth) return this.auth;
        if (this.useLocal) {
            this.authGenAttempts = 99999;
            return;
        }
        if (this.authGenAttempts > 5) {
            this.useLocal = true;
            return;
        }
        return new Promise((resolve) => {
            this.$fetch(this.baseURL+'/auth', {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": this.portalContext.MasterUserInfo.UserId,
                }
            }).then(res=>{
                this.auth=res.token;
                resolve(this.auth);
            }).catch((err) => { console.error("Failed to generate auth token"); console.log(err); this.authGenAttempts++; setTimeout(() => this.$genAuth(), 1000*(this.authGenAttempts+1)); });
        })
    }

    async _fetch(action, key, value = null, json = false) {
        const options = {
            method: ({
                "get": "GET",
                "set": "POST",
                "remove": "DELETE",
                "has": "GET",
            })[action],
            headers: {
                Authorization: this.$genAuth(),
            },
            body: json ? JSON.stringify(value) : value,
        };
        if (action == "set") options.headers['Content-Type'] = 'application/json';
        const response = await this.$fetch(this.baseURL+'/settings/'+key, options).catch(() => null);
        return response;
    }

    set(key, value, json = false) {
        this.cache[key] = value;
        if (this.useLocal) return localStorage.setItem(key, value);
        return this._fetch("set", key, value, json);
    }
    get(key, defaultValue = null, json = false) {
        // TODO: make this work better (specifically defaultValue)
        if (this.cache.hasOwnProperty(key)) return this.cache[key];
        if (this.useLocal) return localStorage.getItem(key) ?? defaultValue;
        return this._fetch("get", key) ?? defaultValue;
    }
    has(key) {
        if (this.cache.hasOwnProperty(key)) return true;
        if (this.useLocal) return !!localStorage.getItem(key);
        return this._fetch("has", key) ?? false;
    }
    remove(key) {
        delete cache[key];
        if (this.useLocal) return localStorage.removeItem(key);
        return this._fetch("remove", key);
    }
}
const pData = new PerisistentMap();

let bpData = {
    set(key, value, json = false) {
        localStorage.setItem(key, json ? JSON.stringify(value) : value);
        return value;
    },
    get(key, defaultValue = null, json = false) {
        return (localStorage.getItem(key) ? (json ? JSON.parse(localStorage.getItem(key)) : localStorage.getItem(key)) : null) ?? defaultValue;
    },
    has(key) {
        if (localStorage.getItem(key)) return true;
        return false;
    },
    remove(key) {
        localStorage.removeItem(key);
    }
}
setInterval(async () => {
    if (lastPagePath == window.location.pathname && lastPageHash == window.location.hash) return;
    lastPagePath = window.location.pathname;
    lastPageHash = window.location.hash;
    clearInterval(pageUpdate);
    events.map((x) => document.body.removeEventListener(x[0], x[1]));
    events = [];
    if (portalContext == null && lastPagePath != "/app" && lastPageHash != "#login") {
        portalContext = await fetch(`https://geffenacademy.myschoolapp.com/api/webapp/context?_=${Date.now()}`).then(res => res.json());
        // pData.portalContext = portalContext;
        // await pData.$genAuth();
        // window.pData = pData;
    }

    if (lastPagePath == "/app/student" && lastPageHash == "#studentmyday/assignment-center") {
        await waitForElm("tbody#assignment-center-assignment-items>tr");
        let hiddenAssignments = bpData.get("betterportal-hidden-assignments", [], true);
        let pinnedAssignments = bpData.get("betterportal-pinned-assignments", [], true);
        pageUpdate = setInterval(async () => {
            const assignments = [...document.querySelector("tbody#assignment-center-assignment-items").children];
            let showButtons = await settingsCache.get("showbuttons"), overdueColor = await settingsCache.get("overduecolor");
            for (let elm of assignments) {
                if (elm.children[1].innerText == "My tasks") continue;
                if (elm.children[2].innerText.includes('Assessment')) continue;
                let assignmentId = elm.children[5].children[0].children[0].children[0].dataset.id,
                    [_, assignmentIndexId] = elm.children[2].children[0].href.replace(/^.+#/, '#').match(/#assignmentdetail\/\d+\/(\d+)/);

                // Hide Assignment (Function)
                if (hiddenAssignments.includes(assignmentId)) {
                    elm.remove();
                    continue;
                }

                // No "Overdue" Red
                if (overdueColor) {
                    if (elm.children[5].innerText.includes("Overdue") && !elm.children[5].innerHTML.includes('betterportal-overdue')) {
                        elm.children[5].children[0].children[0].children[0].classList.add('betterportal-overdue');
                        elm.children[5].children[0].children[0].children[0].style = `background-color: ${overdueColor} !important;`;
                        elm.children[5].children[0].children[0].children[0].classList.remove('label-danger');
                    }
                }

                if (showButtons) {
                    // Hide Assignment (Button)
                    if (!elm.children[6].innerHTML.includes("betterportal-hide-assignment")) {
                        if (elm.children[6].innerText == "Submit") elm.children[6].innerHTML += `<br class="betterportal"/>`;
                        elm.children[6].innerHTML += `<button data-id="${assignmentId}" class="btn btn-link betterportal-hide-assignment" style="padding-left:0px;">Hide</button>`;
                    }
                    // Pin Assignment (Button)
                    // if (!elm.children[6].innerHTML.includes("betterportal-pin-assignment") && !elm.children[6].innerHTML.includes("betterportal-unpin-assignment")) {
                    //     let isPinned = pinnedAssignments.some(x => x.id == assignmentId);
                    //     if (isPinned) elm.children[6].innerHTML += `<button data-id="${assignmentId}" class="btn btn-link betterportal-unpin-assignment" style="margin-left:10px;">Unpin</button>`;
                    //     else elm.children[6].innerHTML += `<button data-id="${assignmentId}" class="btn btn-link betterportal-pin-assignment" style="margin-left:10px;">Pin</button>`;
                    // }
                }

                // Clickable "Graded"
                if (elm.children[5].innerText.includes("Graded") && !elm.children[5].innerHTML.includes('betterportal-graded-clickable')) {
                    elm.children[5].children[0].children[0].children[0].classList.add('betterportal-graded-clickable');
                }


                // Has Saved Notes
                let savedNotesHtml = `<p class="betterportal-savednotes" style="margin:-2px 0px 0px 0px; font-size:11px; color:#700">Has Saved Notes</p>`;
                if (bpData.has(`betterportal-si-${assignmentId}_${assignmentIndexId}`) && !elm.children[2].innerHTML.includes('betterportal-savednotes')) {
                    elm.children[2].innerHTML += savedNotesHtml;
                } else if (!bpData.has(`betterportal-si-${assignmentId}_${assignmentIndexId}`) && elm.children[2].innerHTML.includes('betterportal-savednotes')) {
                    elm.children[2].innerHTML = elm.children[2].innerHTML.replace(savedNotesHtml, '');
                }
            }
        }, 50);

        if ((await settingsCache.get("sortby")) != 'none') {
            await waitForElm(`a[data-sort="${await settingsCache.get("sortby")}"]`);
            let clickEvent = new MouseEvent("click", { bubbles: true, cancelable: true });
            document.querySelector(`a[data-sort="${await settingsCache.get("sortby")}"]`).dispatchEvent(clickEvent);
            if ((await settingsCache.get("sortdir")) == "des") document.querySelector(`a[data-sort="${await settingsCache.get("sortby")}"]`).dispatchEvent(clickEvent);
        }

        const assignmentHeaderViewAdd = (prepend = true, html) => {
            if (!html) throw Error("No HTML Provided! (assignmentHeaderViewAdd)");
            const assignmentHeaderView = document.querySelector("#assignment-center-header-view .pull-right.assignment-calendar-button-bar");
            if (assignmentHeaderView) {
                if (prepend) assignmentHeaderView.innerHTML = html + assignmentHeaderView.innerHTML;
                else assignmentHeaderView.innerHTML += html;
            }
        };
        if (bpData.has("betterportal-hidden-assignments")) {
            assignmentHeaderViewAdd(true, `<button id="betterportal-unhide-all" class="btn btn-default btn-sm" data-toggle="modal"><i class="fa fa-eye"></i> Unhide All</button>`);
        }

        events.push(['click', async (e) => {
            if (e.srcElement.className.includes("betterportal-hide-assignment")) {
                hiddenAssignments.push(e.srcElement.dataset.id);
                e.srcElement.parentElement.parentElement.remove();
                bpData.set("betterportal-hidden-assignments", hiddenAssignments, true)
                if (!document.querySelector("#betterportal-unhide-all")) {
                    assignmentHeaderViewAdd(true, `<button id="betterportal-unhide-all" class="btn btn-default btn-sm" data-toggle="modal"><i class="fa fa-eye"></i> Unhide All</button>`);
                }
            } else if (e.srcElement.id == "betterportal-unhide-all") {
                hiddenAssignments = [];
                bpData.remove("betterportal-hidden-assignments");
                document.querySelector("#betterportal-unhide-all")?.remove();
                window.location.reload(); // Todo, Make this not reload the page.
            } else if (e.srcElement.className.includes("betterportal-pin-assignment")) {
                let assignmentElm = e.srcElement.parentElement.parentElement;
                assignmentElm.children[6].innerHTML = assignmentElm.children[6].innerHTML.replace("betterportal-pin-assignment", "betterportal-unpin-assignment").replace("Pin", "Unpin");
                pinnedAssignments.push({
                    id: e.srcElement.dataset.id,
                    link: assignmentElm.children[2].children[0].href,
                });
                bpData.set("betterportal-pinned-assignments", pinnedAssignments, true);
            } else if (e.srcElement.className.includes("betterportal-unpin-assignment")) {
                let assignmentElm = e.srcElement.parentElement.parentElement;
                assignmentElm.children[6].innerHTML = assignmentElm.children[6].innerHTML.replace("betterportal-unpin-assignment", "betterportal-pin-assignment").replace("Unpin", "Pin");
                pinnedAssignments = pinnedAssignments.filter(x => x.id != e.srcElement.dataset.id);
                if (pinnedAssignments.length == 0) bpData.remove("betterportal-pinned-assignments");
                else bpData.set("betterportal-pinned-assignments", pinnedAssignments, true);
            } else if (e.srcElement.className.includes("betterportal-graded-clickable")) {
                // let assignmentElm = e.srcElement.parentElement.parentElement.parentElement.parentElement.parentElement.parentElement.parentEl
                let assignmentElm = e.srcElement.parentElement.parentElement.parentElement.parentElement;
                let [_, assignmentIndexId] = assignmentElm.children[2].children[0].href.replace(/^.+#/, '#').match(/#assignmentdetail\/\d+\/(\d+)/);
                const data = await fetch(`https://geffenacademy.myschoolapp.com/api/datadirect/AssignmentStudentDetail?format=json&studentId=${portalContext.MasterUserInfo.UserId}&AssignmentIndexId=${assignmentIndexId}`, { "method": "GET", "mode": "cors", "credentials": "include" }).then((res)=>res.json());
                const assignmentDetails = data.find(x=>x);

                e.srcElement.innerHTML = e.srcElement.innerHTML.replace("betterportal-graded-clickable", "betterportal-graded-clicked");                
                let stringGrade = `${assignmentDetails.pointsEarned}/${assignmentDetails.maxPoints} (${assignmentDetails.pointsEarned/assignmentDetails.maxPoints.toFixed(2)}%)`;
                e.srcElement.parentElement.innerHTML += `<br /><span class="label label-success primary-status betterportal-grade-show">${stringGrade}</span>`;
            } else {
                console.log(e.srcElement);
            }
        }]);
        const assignments = [...document.querySelector("tbody#assignment-center-assignment-items").children];
        console.log("Assignments Loaded!", assignments.length);
    } else if (lastPagePath == "/app/student" && lastPageHash.startsWith("#assignmentdetail/")) {
        addAssignmentDetailExtras();
        events.push(['click', (e) => {
            if(e.srcElement.id == "save-button") {
                setTimeout(() => {
                    addAssignmentDetailExtras();
                }, 5000)
            }
        }]);
    }
    events.map((x) => document.body.addEventListener(x[0], x[1]));
}, 25);

const addAssignmentDetailExtras = async () => {
    await waitForElm("div#assignment-detail-assignment .bb-tile-content-section");
    const [_, assignmentId, assignmentIndexId] = lastPageHash.match(/#assignmentdetail\/(\d+)\/(\d+)/);
    if (await settingsCache.get("savednotes")) {
        if (!document.querySelector("#betterportal-text-content")) {
            document.querySelector("#assignment-detail-assignment .bb-tile-content-section").innerHTML += `<div id="betterportal-text-content">
    <div class="well well-sm" style="margin:10px 0px 5px 0px">
    <h3>Saved Notes</h3>
    <textarea id="betterportal-savedinfo" style="min-height:100px;width:100%;resize:vertical;"></textarea>
    </div>
</div>`;
        }
        document.querySelector("#betterportal-text-content textarea").value = bpData.get(`betterportal-si-${assignmentId}_${assignmentIndexId}`, "");
        events.push(['input', (e) => {
            if (e.srcElement.id == "betterportal-savedinfo") {
                if (e.srcElement.value.length == 0) bpData.remove(`betterportal-si-${assignmentId}_${assignmentIndexId}`);
                else bpData.set(`betterportal-si-${assignmentId}_${assignmentIndexId}`, e.srcElement.value);
            }
        }])
    }
    if (await settingsCache.get("classlinks")) {
        const assignmentDetails = document.querySelector("#assignment-detail-assignment .bb-tile-content-section button");
        const groupName = assignmentDetails.innerText.split('| ').pop().split(' (')[0];
        const group = portalContext.Groups.find((x) => x.GroupName == groupName && x.CurrentEnrollment);

        if (!document.querySelector("#betterportal-link-content")) {
            document.querySelector("#assignment-detail-assignment .bb-tile-content-section").innerHTML += `<div id="betterportal-link-content">
    <div class="well well-sm" style="margin:10px 0px 5px 0px">
    <h3>Class Links</h3>
    <ul>
        ${group ? `<li><a href="#academicclass/${group.CurrentSectionId}/0/bulletinboard">Class Bulletin Board</a></li>` : ""}
    </ul>
    </div>
</div>`;
        }
    }
}