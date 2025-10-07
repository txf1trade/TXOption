document.addEventListener("DOMContentLoaded", () => {
    const sidebar = document.getElementById("sidebar");
    let isOpen = false;
    let usageInterval = null;
    let marketInterval = null;
    let snapshotInterval = null;
    let snapshotOrder = "desc";

    const topBar = document.querySelector(".top-bar");
    topBar.addEventListener("click", () => {
        isOpen = !isOpen;
        sidebar.classList.toggle("show", isOpen);
    });

    // 卡片收合 / 展開
    document.querySelectorAll(".card-header").forEach(header => {
        header.addEventListener("click", () => {
            const card = header.closest(".card");
            card.classList.toggle("collapsed");
            const icon = header.querySelector(".toggle-icon");
            if (icon) icon.textContent = card.classList.contains("collapsed") ? "+" : "-";
        });
    });

    // 顯示台灣時間
    function updateTime() {
        const twEl = document.getElementById("tw-time");
        if (!twEl) return;
        const now = new Date();
        const twOffset = 8 * 60;
        const utc = now.getTime() + now.getTimezoneOffset() * 60000;
        const twTime = new Date(utc + twOffset * 60000);
        const formatted = `${twTime.getFullYear()}/${String(twTime.getMonth() + 1).padStart(2, "0")}/${String(twTime.getDate()).padStart(2, "0")} ${String(twTime.getHours()).padStart(2, "0")}:${String(twTime.getMinutes()).padStart(2, "0")}:${String(twTime.getSeconds()).padStart(2, "0")}`;
        twEl.textContent = formatted;
    }
    updateTime();
    setInterval(updateTime, 1000);

    // 登入視窗元素
    const loginModal = document.getElementById("login-modal");
    const confirmLogin = document.getElementById("confirm-login");
    const cancelLogin = document.getElementById("cancel-login");
    const apiKeyInput = document.getElementById("api-key");
    const secretKeyInput = document.getElementById("secret-key");
    const useCaCheckbox = document.getElementById("use-ca");
    const caIdInput = document.getElementById("ca-id");
    const caPwdInput = document.getElementById("ca-password");
    const rememberMe = document.getElementById("remember-me");
    const loginStatus = document.getElementById("login-status");
    const selectedTxSpan = document.getElementById("selected-tx");
    const txSelect = document.getElementById("option-select");
    const sidebarLoginLink = document.getElementById("sidebar-login-link");
    const snapshotOrderToggle = document.getElementById("snapshot-order-toggle");
    const volumeCheckbox = document.getElementById("toggle-volume");

    // 新增價平自動對齊核選
    const atmViewCheckbox = document.getElementById("toggle-atm-view");

    // 顯示/隱藏 CA 欄位
    useCaCheckbox.addEventListener("change", () => {
        document.querySelectorAll(".ca-inputs").forEach(el => {
            el.style.display = useCaCheckbox.checked ? "flex" : "none";
        });
    });

    // 儲存/讀取歷史資料
    function getHistory(key) { return JSON.parse(localStorage.getItem(key)) || []; }
    function saveHistory(key, value) {
        if (!value) return;
        let arr = getHistory(key);
        if (!arr.includes(value)) { arr.unshift(value); if (arr.length > 10) arr.pop(); localStorage.setItem(key, JSON.stringify(arr)); }
    }
    function setupDatalist(inputEl, historyKey) {
        const listId = inputEl.id + "-history";
        let datalist = document.getElementById(listId);
        if (!datalist) {
            datalist = document.createElement("datalist");
            datalist.id = listId;
            document.body.appendChild(datalist);
            inputEl.setAttribute("list", listId);
        }
        function refreshOptions() {
            datalist.innerHTML = "";
            getHistory(historyKey).forEach(v => {
                const option = document.createElement("option");
                option.value = v;
                datalist.appendChild(option);
            });
        }
        inputEl.addEventListener("focus", refreshOptions);
        refreshOptions();
    }
    setupDatalist(apiKeyInput, "historyApiKey");
    setupDatalist(secretKeyInput, "historySecretKey");
    setupDatalist(caIdInput, "historyCaId");
    setupDatalist(caPwdInput, "historyCaPwd");

    // 側邊欄登入連結
    if (sidebarLoginLink) {
        sidebarLoginLink.addEventListener("click", e => { e.preventDefault(); loginModal.style.display = "flex"; });
    }

    // 更新使用量
    async function updateUsage(savedData) {
        if (!savedData) return;
        try {
            const res = await fetch("/usage");
            const data = await res.json();
            if (data.logged_in) {
                const usageText = `流量：${data.used} / ${data.limit} ${data.unit}`;
                const lastLogin = savedData.lastLogin || "尚未登入";
                const caStatus = savedData.caStatus || "未啟用";
                const personId = savedData.personId || "未知";

                loginStatus.innerHTML = `${usageText}<br>帳號：${personId} <a href="#" id="logout-link">登出</a><br>CA 狀態：${caStatus}<br>上次登入：${lastLogin}`;
                if (sidebarLoginLink) sidebarLoginLink.style.display = "none";
            }
        } catch (err) { console.error("更新流量失敗", err); }
    }

    // 登出
    const logoutHandler = () => {
        localStorage.removeItem("loginData");
        if (usageInterval) clearInterval(usageInterval);
        if (marketInterval) clearInterval(marketInterval);
        if (snapshotInterval) clearInterval(snapshotInterval);

        apiKeyInput.value = "";
        secretKeyInput.value = "";
        useCaCheckbox.checked = false;
        caIdInput.value = "";
        caPwdInput.value = "";
        rememberMe.checked = false;
        document.querySelectorAll(".ca-inputs").forEach(el => el.style.display = "none");

        loginStatus.innerHTML = "尚未登入";
        if (sidebarLoginLink) sidebarLoginLink.style.display = "inline-block";
        loginModal.style.display = "flex";

        // 清空市場與期權資料
        ["txf-value","total-volume","twii-value","otc-value","txf-header-price","txf-header-change","selected-tx"].forEach(id=>{
            const el = document.getElementById(id);
            if(el) el.textContent="-";
        });
        txSelect.innerHTML='<option value="">請選擇合約</option>';
        const snapshotTable = document.getElementById("snapshot-table");
        const snapshotEmpty = document.getElementById("snapshot-empty");
        if(snapshotTable) snapshotTable.style.display="none";
        if(snapshotEmpty) snapshotEmpty.style.display="block";
    };

    document.addEventListener("click", e => {
        if(e.target && e.target.id==="logout-link") { e.preventDefault(); logoutHandler(); }
    });

    // 登入
    confirmLogin.addEventListener("click", async ()=>{
        const data={ apiKey:apiKeyInput.value.trim(), secretKey:secretKeyInput.value.trim(), useCa:useCaCheckbox.checked, caId:caIdInput.value.trim(), caPwd:caPwdInput.value.trim() };
        if(!data.apiKey||!data.secretKey){ alert("請輸入 API Key 與 Secret Key"); return; }
        if(data.useCa && (!data.caId||!data.caPwd)){ alert("請輸入 CA 資訊"); return; }

        try{
            const res = await fetch("/login",{ method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data) });
            const result = await res.json();

            if(result.success){
                const personId = result.person_id||"未知帳號";
                const caStatus = result.ca_status||"未啟用";
                const now = new Date();
                const timeStr = `${now.getFullYear()}/${String(now.getMonth()+1).padStart(2,'0')}/${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

                const tempData={ apiKey:data.apiKey, secretKey:data.secretKey, personId, caStatus, lastLogin:timeStr };
                saveHistory("historyApiKey",data.apiKey);
                saveHistory("historySecretKey",data.secretKey);
                if(data.useCa){ saveHistory("historyCaId",data.caId); saveHistory("historyCaPwd",data.caPwd); }
                if(rememberMe.checked) localStorage.setItem("loginData",JSON.stringify(tempData));

                loginModal.style.display="none";
                updateUsage(tempData);
                usageInterval=setInterval(()=>updateUsage(tempData),180000);
                startMarketUpdates();
                if(sidebarLoginLink) sidebarLoginLink.style.display="none";
                loadOptions();
            }else{ alert("登入失敗："+result.message); }
        }catch(err){ console.error(err); alert("登入失敗，請確認網路或伺服器狀態"); }
    });

    cancelLogin.addEventListener("click", ()=>loginModal.style.display="none");

    // 初始化登入資訊
    const savedData = JSON.parse(localStorage.getItem("loginData"));
    if(savedData){
        loginModal.style.display="none";
        updateUsage(savedData);
        usageInterval=setInterval(()=>updateUsage(savedData),180000);
        startMarketUpdates();
        if(sidebarLoginLink) sidebarLoginLink.style.display="none";
        loadOptions();
    }else{
        loginModal.style.display="flex";
        if(sidebarLoginLink) sidebarLoginLink.style.display="inline-block";
        loginStatus.innerHTML="尚未登入";
    }

    // 下拉選單
    txSelect.addEventListener("change",()=>{
        if(!window.txSeriesData) return;
        const selected = window.txSeriesData.find(x=>x.series===txSelect.value);
        selectedTxSpan.textContent = selected ? `${selected.type} ${selected.series} (${selected.days_left}天)`:"-";
        selectedTxSpan.style.fontWeight="bold";
        selectedTxSpan.style.color="#06b6d4";
        updateOptionTable();
        stopSnapshotInterval();
        startSnapshotIntervalIfNeeded();
        fetchAndRenderSnapshot();
    });

    // Snapshot 排序按鈕
    if(snapshotOrderToggle) snapshotOrderToggle.addEventListener("click",()=>{
        snapshotOrder = snapshotOrder==="desc"?"asc":"desc";
        snapshotOrderToggle.textContent = snapshotOrder==="desc"?"排序：降冪":"排序：升冪";
        fetchAndRenderSnapshot();
    });

    // =====================
    // 載入選擇權資料
    // =====================
    async function loadOptions(){
        try{
            const res = await fetch('/get_options');
            const data = await res.json();
            if(!txSelect || !selectedTxSpan) return;
            txSelect.innerHTML='<option value="">請選擇合約</option>';
            if(!data.tx_series_list || data.tx_series_list.length===0){ selectedTxSpan.textContent="-"; return; }
            data.tx_series_list.sort((a,b)=>a.days_left-b.days_left);
            window.txSeriesData=data.tx_series_list;

            data.tx_series_list.forEach(item=>{
                const opt = document.createElement("option");
                opt.value=item.series;
                opt.textContent=`${item.type} ${item.series} (${item.days_left}天)`;
                txSelect.appendChild(opt);
            });

            const defaultItem = data.tx_series_list.find(x=>x.series===data.default_series);
            if(defaultItem){
                txSelect.value=defaultItem.series;
                selectedTxSpan.textContent=`${defaultItem.type} ${defaultItem.series} (${defaultItem.days_left}天)`;
                startSnapshotIntervalIfNeeded();
                fetchAndRenderSnapshot();
            }else selectedTxSpan.textContent="-";
        }catch(err){ console.error("載入選擇權資料時發生錯誤:",err); }
    }

    // =====================
    // 市場資料更新
    // =====================
    async function startMarketUpdates(){ await updateMarketData(); if(marketInterval) clearInterval(marketInterval); marketInterval=setInterval(updateMarketData,3000);}
    async function updateMarketData(){
        try{
            const res = await fetch("/get_market_data");
            const data = await res.json();
            document.getElementById("txf-value").textContent=data.txf_price;
            document.getElementById("total-volume").textContent=data.txf_total_volume;
            document.getElementById("twii-value").textContent=data.twii;
            document.getElementById("otc-value").textContent=data.otc;

            const headerPrice=document.getElementById("txf-header-price");
            const headerChange=document.getElementById("txf-header-change");
            headerPrice.textContent=data.txf_price;

            let symbol="–", colorClass="zero";
            if(data.change_price!=="-" && data.change_price!==null){
                if(data.change_price>0){ symbol="  ▲"; colorClass="positive"; }
                else if(data.change_price<0){ symbol="　▼"; colorClass="negative"; }
            }
            headerChange.textContent=`${symbol}${Math.abs(data.change_price)}`;
            headerChange.className="header-change "+colorClass;
            headerPrice.className="header-price "+colorClass;
        }catch(err){ console.error("更新期貨資料失敗",err); }
    }

    // =====================
    // Snapshot
    // =====================
    async function fetchSnapshot(series,order="desc"){ if(!series) return null; try{ const res=await fetch(`/snapshot?series=${encodeURIComponent(series)}&order=${order}`); return await res.json(); }catch(err){ console.error("fetchSnapshot error:",err); return null;} }

    function scrollToATM() {
        if(!atmViewCheckbox.checked) return;
        const snapshotBody=document.getElementById("snapshot-body");
        if(!snapshotBody) return;
        const atmRow=snapshotBody.querySelector(".atm-row");
        if(!atmRow) return;
        const container=document.getElementById("snapshot-table-container") || snapshotBody.parentElement;
        const containerHeight=container.clientHeight;
        const rowOffset=atmRow.offsetTop;
        const rowHeight=atmRow.clientHeight;
        container.scrollTop=rowOffset-(containerHeight/2)+(rowHeight/2);
    }

    function renderSnapshot(data){
        const table=document.getElementById("snapshot-table");
        const tbody=document.getElementById("snapshot-body");
        const empty=document.getElementById("snapshot-empty");

        if(!data||!data.rows||data.rows.length===0){ table.style.display="none"; empty.style.display="block"; tbody.innerHTML=""; return; }

        table.style.display="table"; empty.style.display="none"; tbody.innerHTML="";

        let maxCallVol=-Infinity,maxPutVol=-Infinity,minSumCP=Infinity,atmIndex=-1;

        data.rows.forEach((row,index)=>{
            const callVol=row.call_volume!=="-"?Number(row.call_volume):null;
            const putVol=row.put_volume!=="-"?Number(row.put_volume):null;
            const cPrice=row.call_price!=="-"?Number(row.call_price):null;
            const pPrice=row.put_price!=="-"?Number(row.put_price):null;

            if(callVol!==null && callVol>maxCallVol) maxCallVol=callVol;
            if(putVol!==null && putVol>maxPutVol) maxPutVol=putVol;

            if(cPrice!==null && pPrice!==null){
                const sumCP=cPrice+pPrice;
                if(sumCP<minSumCP){ minSumCP=sumCP; atmIndex=index; }
            }
        });

        const tCandidates=data.rows.map(row=>{ const c=row.call_price!=="-"?Number(row.call_price):null; const p=row.put_price!=="-"?Number(row.put_price):null; if(c===null||p===null) return null; return Math.min(c,p); });
        let maxTCandidate=-Infinity,tIndex=-1;
        tCandidates.forEach((v,i)=>{ if(v!==null && v>maxTCandidate){ maxTCandidate=v; tIndex=i; } });

        data.rows.forEach((row,index)=>{
            const tr=document.createElement("tr");

            const cv=row.call_volume!=="-"?Number(row.call_volume):null;
            const pv=row.put_volume!=="-"?Number(row.put_volume):null;

            const callVolStyle=(cv!==null && cv===maxCallVol)?"background-color:#459100;color:white;":"";
            const putVolStyle=(pv!==null && pv===maxPutVol)?"background-color:#ff3826;color:white;":"";

            const isAtm=index===atmIndex;
            const atmStyleCells=isAtm?"background-color:#ffc237;color:black;":"";
            const atmSumStyle=isAtm?"background-color:#dc360e;color:white;":"";

            const isTIndex=index===tIndex;
            const tValueStyle=isTIndex?"background-color:#338bff;color:white;":"";
            const wsStyle=isTIndex?"background-color:#ad1dcf;color:white;":"";

            if(isAtm) tr.classList.add("atm-row");

            tr.innerHTML=`
                <td style="${callVolStyle}">${row.call_volume||'-'}</td>
                <td>${row.call_price||'-'}</td>
                <td style="${atmStyleCells}">${row.strike||'-'}</td>
                <td>${row.put_price||'-'}</td>
                <td style="${putVolStyle}">${row.put_volume||'-'}</td>
                <td style="${atmSumStyle}">${row.atm_sum||'-'}</td>
                <td style="${tValueStyle}">${row.t_value||'-'}</td>
                <td style="${wsStyle}">${row.week_small||'-'}</td>
            `;

            tbody.appendChild(tr);
        });

        updateOptionTable();
        scrollToATM();
    }

    async function fetchAndRenderSnapshot(){
        const series=txSelect.value;
        if(!series){ renderSnapshot(null); return; }
        const data=await fetchSnapshot(series,snapshotOrder);
        renderSnapshot(data);
    }

    function startSnapshotIntervalIfNeeded(){
        const series=txSelect.value;
        if(!series) return;
        if(snapshotInterval) clearInterval(snapshotInterval);
        snapshotInterval=setInterval(fetchAndRenderSnapshot,3000);
    }

    function stopSnapshotInterval(){ if(snapshotInterval){ clearInterval(snapshotInterval); snapshotInterval=null; } }

    // =====================
    // 成交量顯示 & 價平核選控制
    // =====================
    function updateOptionTable(){
        const showVolume=volumeCheckbox.checked;

        document.querySelectorAll("#snapshot-body tr").forEach(tr=>{
            if(!tr.children[0]||!tr.children[4]) return;
            tr.children[0].style.display=showVolume?"":"none"; // C量
            tr.children[4].style.display=showVolume?"":"none"; // P量
        });

        const ths=document.querySelectorAll("#snapshot-table thead th");
        if(ths.length>=5){ ths[0].style.display=showVolume?"":"none"; ths[4].style.display=showVolume?"":"none"; }

        scrollToATM(); // 勾選價平時自動捲動
    }

    volumeCheckbox.addEventListener("change",updateOptionTable);
    // 勾選後資料更新時捲動
    // if(atmViewCheckbox) atmViewCheckbox.addEventListener("change",scrollToATM);
    // 勾選時才捲動
    if(atmViewCheckbox) {
    atmViewCheckbox.addEventListener("change", () => {
        if (atmViewCheckbox.checked) scrollToATM();
    });
}

});


// =====================
// 台指期籌碼
// =====================
// =====================
// 即時籌碼更新
// =====================
// async function fetchRealtimeValues() {
//   try {
//     const res = await fetch('https://market-data-api.futures-ai.com/chip960_tradeinfo/');
//     const data = await res.json();

//     const { tx_bvav, mtx_tbta, mtx_bvav } = data;
//     const mtx_tx = tx_bvav + mtx_bvav;

//     // 更新四個方塊數值
//     updateChip('tx_bvav', tx_bvav);
//     updateChip('mtx_tbta', mtx_tbta);
//     updateChip('mtx_bvav', mtx_bvav);
//     updateChip('mtx_p', mtx_tx);

//     // 更新方塊顏色
//     setColors('tank-category', tx_bvav);
//     setColors('cannon-fodder-category', mtx_tbta);
//     setColors('guerrilla-category', mtx_bvav);
//     setColors('guerrilla-tank', mtx_tx);
//   } catch (err) {
//     console.error('數值獲取錯誤:', err);
//   }
// }

// // 更新單個方塊數值
// function updateChip(id, val) {
//   const el = document.getElementById(id);
//   if (el) el.textContent = val;
// }

// // 更新籌碼方塊顏色
// function setColors(id, val) {
//   const box = document.getElementById(id);
//   if (!box) return;

//   const el = box.querySelector('.category-value');
//   const positiveColor = '#cc393b'; // 紅色
//   const negativeColor = '#66a43a'; // 綠色
//   const bgPositive = '#452121';
//   const bgNegative = '#243620';

//   if (id === 'cannon-fodder-category') {
//     // 特殊方塊顏色對調
//     el.style.backgroundColor = val > 0 ? negativeColor : positiveColor;
//     box.style.backgroundColor = val > 0 ? bgNegative : bgPositive;
//   } else {
//     el.style.backgroundColor = val > 0 ? positiveColor : negativeColor;
//     box.style.backgroundColor = val > 0 ? bgPositive : bgNegative;
//   }
// }

// // =====================
// // 頁面載入後啟動更新
// // =====================
// document.addEventListener("DOMContentLoaded", () => {
//   fetchRealtimeValues();           // 初始抓取一次
//   setInterval(fetchRealtimeValues, 2000); // 每10秒更新
// });
