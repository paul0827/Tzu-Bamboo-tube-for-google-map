const GOOGLE_MAPS_API_KEY = "AIzaSyDL8aFUIBwB0k_bDKHqid2fXdKQ7Ny2DlI";
const API_BASE = "api/index.php";

const form = document.getElementById("pinForm");
const nameInput = document.getElementById("name");
const addressInput = document.getElementById("address");
const statusEl = document.getElementById("status");
const roleSelect = document.getElementById("roleSelect");
const roleStatus = document.getElementById("roleStatus");
const userPane = document.getElementById("userPane");
const userNameInput = document.getElementById("userName");
const userPasswordInput = document.getElementById("userPassword");
const userLoginBtn = document.getElementById("userLogin");
const userLogoutBtn = document.getElementById("userLogout");
const addBtn = document.getElementById("addBtn");
const clearBtn = document.getElementById("clearBtn");
const resetBtn = document.getElementById("resetBtn");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const exportBtn = document.getElementById("exportBtn");
const importBtn = document.getElementById("importBtn");
const csvFileInput = document.getElementById("csvFile");
const userForm = document.getElementById("userForm");
const newUserNameInput = document.getElementById("newUserName");
const newUserPasswordInput = document.getElementById("newUserPassword");
const userTableBody = document.querySelector("#userTable tbody");
const tableBody = document.querySelector("#storeTable tbody");
const table = document.getElementById("storeTable");
const loginInfoUser = document.getElementById("loginInfoUser");
const loginInfoTime = document.getElementById("loginInfoTime");
const loginInfoLocation = document.getElementById("loginInfoLocation");
const loginInfoStatus = document.getElementById("loginInfoStatus");

let currentRole = "user";
let currentProfile = null;
let authUser = null;
let editingId = null;
let storePins = [];
let users = [];
let markers = new Map();
let map = null;
let infoWindow = null;
let mapReadyResolve = null;
const mapReady = new Promise((resolve) => {
  mapReadyResolve = resolve;
});
let pollTimer = null;
let pollInFlight = false;

renderAll();
renderUsers();
updateAuthUI();
initSession();

roleSelect.addEventListener("change", () => {
  currentRole = roleSelect.value;
  updateAuthUI();
  if (authUser && currentProfile && currentProfile.role !== currentRole) {
    status(`此帳號角色為「${roleLabel(currentProfile.role)}」，請選擇正確角色。`);
  }
});

userLoginBtn.addEventListener("click", () => {
  handleUserLogin();
});

userLogoutBtn.addEventListener("click", () => {
  handleUserLogout();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (editingId) {
    await submitEdit();
    return;
  }
  if (!canAddPins()) {
    status("請先登入才能新增。");
    return;
  }
  const name = nameInput.value.trim();
  const address = addressInput.value.trim();

  if (!name || !address) {
    status("請填寫店名與地址。");
    return;
  }

  if (existsPin(name, address)) {
    status("此店家已存在，不能重複新增。");
    return;
  }

  setBusy(true);
  try {
    const coords = await resolveCoordsForAdd(address);
    if (!coords) {
      return;
    }

    const result = await insertPin({
      name,
      address,
      lat: coords.lat,
      lng: coords.lng,
    });
    if (!result) {
      return;
    }
    renderAll();
    focusPin(result.id);
    form.reset();
    status("已新增並在地圖上標記。");
  } catch (err) {
    console.error(err);
    status("新增失敗，請稍後再試。");
  } finally {
    setBusy(false);
  }
});

resetBtn.addEventListener("click", () => {
  if (editingId) {
    cancelEdit(true);
    return;
  }
  form.reset();
  status("已清除輸入。");
});

cancelEditBtn.addEventListener("click", () => {
  cancelEdit(true);
});

userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isAdmin()) {
    status("只有管理員可以開通帳號。");
    return;
  }
  const username = newUserNameInput.value.trim();
  const password = newUserPasswordInput.value;
  if (!username || !password) {
    status("請輸入帳號與密碼。");
    return;
  }
  await createUserAccount(username, password);
});

if (userTableBody) {
  userTableBody.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }
    if (!isAdmin()) {
      status("只有管理員可以管理帳號。");
      return;
    }
    const userId = button.getAttribute("data-id");
    const action = button.getAttribute("data-action");
    if (action === "toggle") {
      toggleUserActive(userId);
    }
    if (action === "delete") {
      deleteUser(userId);
    }
  });
}

exportBtn.addEventListener("click", () => {
  exportCsv();
});

importBtn.addEventListener("click", () => {
  if (!canAddPins()) {
    status("請先登入才能匯入。");
    return;
  }
  csvFileInput.click();
});

csvFileInput.addEventListener("change", async () => {
  const file = csvFileInput.files && csvFileInput.files[0];
  csvFileInput.value = "";
  if (!file) {
    return;
  }
  if (!canAddPins()) {
    status("請先登入才能匯入。");
    return;
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    status("請選擇 CSV 檔案。");
    return;
  }
  try {
    status("正在匯入 CSV...");
    setActionBusy(true);
    const text = await file.text();
    await importCsvText(text);
  } catch (err) {
    console.error(err);
    status("CSV 匯入失敗。");
  } finally {
    setActionBusy(false);
  }
});

clearBtn.addEventListener("click", async () => {
  if (!isAdmin()) {
    status("只有管理員可以清空資料。");
    return;
  }

  if (!confirm("確定要刪除全部資料嗎？")) {
    return;
  }

  const success = await clearAllPins();
  if (success) {
    cancelEdit(false);
    status("已清空所有標記。");
  }
});

function updateAuthUI() {
  if (!isAdmin() && editingId) {
    cancelEdit(false);
  }

  if (userPane) {
    userPane.classList.add("active");
  }

  userLoginBtn.style.display = authUser ? "none" : "inline-flex";
  userLogoutBtn.style.display = authUser ? "inline-flex" : "none";

  document.body.classList.toggle("admin", isAdmin());
  if (roleSelect) {
    roleSelect.disabled = !!authUser;
  }
  if (roleStatus) {
    if (authUser && currentProfile) {
      roleStatus.textContent = `已登入：${currentProfile.username}（${roleLabel(
        currentProfile.role
      )}）`;
    } else {
      roleStatus.textContent = "尚未登入";
    }
  }

  applyPermissionState();
  renderUsers();
  updateLoginInfo();
}

function canAddPins() {
  return !!authUser && !!currentProfile && currentProfile.active;
}

function applyPermissionState() {
  const canAdd = canAddPins();
  [nameInput, addressInput, addBtn, resetBtn].forEach((el) => {
    if (el) {
      el.disabled = !canAdd;
    }
  });
  if (importBtn) {
    importBtn.disabled = !canAdd;
  }
}

function apiUrl(action) {
  const url = new URL(API_BASE, window.location.href);
  url.searchParams.set("action", action);
  return url.toString();
}

async function apiRequest(action, payload = null, method = "POST") {
  const options = {
    method,
    credentials: "same-origin",
    headers: {},
  };
  if (method !== "GET") {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(payload || {});
  }
  const response = await fetch(apiUrl(action), options);
  let result = null;
  try {
    result = await response.json();
  } catch {
    // ignore
  }
  if (!response.ok || !result || result.ok === false) {
    const message = result && result.error ? result.error : "伺服器回應失敗。";
    throw new Error(message);
  }
  return result.data || null;
}

function roleLabel(role) {
  return role === "admin" ? "管理員" : "使用者";
}

function isAdmin() {
  return !!currentProfile && currentProfile.role === "admin";
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePinData(data) {
  if (!data) {
    return null;
  }
  return {
    id: data.id,
    name: data.name || "",
    address: data.address || "",
    lat: Number(data.lat),
    lng: Number(data.lng),
    createdAt: data.createdAt || null,
  };
}

function upsertLocalPin(pin) {
  if (!pin) {
    return;
  }
  const index = storePins.findIndex((item) => item.id === pin.id);
  if (index >= 0) {
    storePins[index] = { ...storePins[index], ...pin };
  } else {
    storePins.push(pin);
  }
}

function removeLocalPin(id) {
  storePins = storePins.filter((pin) => pin.id !== id);
}

function normalizeProfileData(data) {
  if (!data) {
    return null;
  }
  return {
    id: data.id,
    username: data.username || "",
    role: data.role || "user",
    active: data.active !== false,
    createdAt: data.createdAt || null,
    lastLoginAt: data.lastLoginAt || null,
    lastLoginLat: normalizeNumber(data.lastLoginLat),
    lastLoginLng: normalizeNumber(data.lastLoginLng),
    lastLoginAccuracy: normalizeNumber(data.lastLoginAccuracy),
    lastLoginStatus: data.lastLoginStatus || "尚未登入",
  };
}

function updateLocalProfile(profile) {
  if (!profile) {
    return;
  }
  if (currentProfile && currentProfile.id === profile.id) {
    currentProfile = { ...currentProfile, ...profile };
  }
  const index = users.findIndex((item) => item.id === profile.id);
  if (index >= 0) {
    users[index] = { ...users[index], ...profile };
  }
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling() {
  if (pollTimer) {
    return;
  }
  pollTimer = setInterval(async () => {
    if (!authUser || pollInFlight) {
      return;
    }
    pollInFlight = true;
    try {
      await loadPinsFromDb();
      if (isAdmin()) {
        await loadUsersFromDb();
      }
    } catch (err) {
      console.error(err);
    } finally {
      pollInFlight = false;
    }
  }, 6000);
}

function resetAuthState() {
  stopPolling();
  pollInFlight = false;
  authUser = null;
  currentProfile = null;
  currentRole = roleSelect ? roleSelect.value : "user";
  users = [];
  storePins = [];
  renderAll();
  renderUsers();
  updateAuthUI();
}

async function initSession() {
  try {
    const data = await apiRequest("session", null, "GET");
    if (data && data.user) {
      currentProfile = normalizeProfileData(data.user);
      authUser = currentProfile;
      currentRole = currentProfile.role;
      if (roleSelect) {
        roleSelect.value = currentRole;
      }
      await afterLoginSetup(false);
      return;
    }
    resetAuthState();
  } catch (err) {
    console.error(err);
    resetAuthState();
    status("初始化失敗，請確認伺服器狀態。");
  }
}

async function handleUserLogin() {
  const username = userNameInput.value.trim();
  const password = userPasswordInput.value;
  if (!username || !password) {
    status("請輸入帳號與密碼。");
    return;
  }
  try {
    const data = await apiRequest("login", {
      username,
      password,
      role: roleSelect ? roleSelect.value : "user",
    });
    currentProfile = normalizeProfileData(data.user);
    authUser = currentProfile;
    currentRole = currentProfile.role;
    if (roleSelect) {
      roleSelect.value = currentRole;
    }
    userPasswordInput.value = "";
    await afterLoginSetup(true);
  } catch (err) {
    console.error(err);
    status(err.message || "帳號或密碼錯誤。");
  }
}

async function handleUserLogout() {
  try {
    await apiRequest("logout", {});
  } catch (err) {
    console.error(err);
  }
  resetAuthState();
  status("已登出。");
}

async function afterLoginSetup(recordLocation) {
  updateAuthUI();
  await loadPinsFromDb();
  await loadUsersFromDb();
  startPolling();
  if (recordLocation && currentProfile) {
    status(`已登入：${currentProfile.username}，正在取得定位...`);
    recordLoginLocation(currentProfile);
  } else if (currentProfile) {
    status(`已登入：${currentProfile.username}`);
  }
}

async function loadPinsFromDb() {
  if (!authUser) {
    storePins = [];
    renderAll();
    return;
  }
  try {
    const data = await apiRequest("pins:list", null, "GET");
    storePins = (data.pins || []).map(normalizePinData).filter(Boolean);
    renderAll();
  } catch (err) {
    console.error(err);
    status(err.message || "載入資料失敗，請確認權限或網路狀態。");
  }
}

async function loadUsersFromDb() {
  if (!isAdmin()) {
    users = [];
    renderUsers();
    return;
  }
  try {
    const data = await apiRequest("users:list", null, "GET");
    users = (data.users || []).map(normalizeProfileData).filter(Boolean);
    renderUsers();
  } catch (err) {
    console.error(err);
    status(err.message || "載入使用者清單失敗。");
  }
}

async function insertPin(payload) {
  try {
    const data = await apiRequest("pins:add", payload);
    const pin = normalizePinData(data.pin);
    upsertLocalPin(pin);
    return pin;
  } catch (err) {
    console.error(err);
    status(err.message || "新增失敗，請確認資料或網路狀態。");
    return null;
  }
}

async function updatePinById(id, payload) {
  try {
    const data = await apiRequest("pins:update", { id, ...payload });
    const pin = normalizePinData(data.pin);
    upsertLocalPin(pin);
    return pin;
  } catch (err) {
    console.error(err);
    status(err.message || "更新失敗，請稍後再試。");
    return null;
  }
}

async function deletePinById(id) {
  try {
    await apiRequest("pins:delete", { id });
    removeLocalPin(id);
    renderAll();
    return true;
  } catch (err) {
    console.error(err);
    status(err.message || "刪除失敗，請稍後再試。");
    return false;
  }
}

async function clearAllPins() {
  try {
    await apiRequest("pins:clear", {});
    storePins = [];
    renderAll();
    return true;
  } catch (err) {
    console.error(err);
    status(err.message || "清空失敗，請稍後再試。");
    return false;
  }
}

async function createUserAccount(username, password) {
  try {
    await apiRequest("users:create", { username, password });
    newUserNameInput.value = "";
    newUserPasswordInput.value = "";
    status("已開通使用者帳號。");
    await loadUsersFromDb();
  } catch (err) {
    console.error(err);
    status(err.message || "開通帳號失敗。");
  }
}

async function deleteUserAccount(userId) {
  try {
    await apiRequest("users:delete", { id: userId });
    return true;
  } catch (err) {
    console.error(err);
    status(err.message || "刪除帳號失敗。");
    return false;
  }
}

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 20, lng: 0 },
    zoom: 2,
    mapTypeControl: false,
    streetViewControl: false,
  });
  infoWindow = new google.maps.InfoWindow();
  renderMarkers();
  if (mapReadyResolve) {
    mapReadyResolve();
    mapReadyResolve = null;
  }
}

function loadGoogleMaps() {
  if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === "YOUR_GOOGLE_MAPS_API_KEY") {
    status("請先設定 Google Maps API Key。");
    return;
  }
  if (window.google && window.google.maps) {
    initMap();
    return;
  }
  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
    GOOGLE_MAPS_API_KEY
  )}&loading=async&callback=initMap&language=zh-TW&region=TW`;
  script.async = true;
  script.defer = true;
  script.onerror = () => status("Google 地圖載入失敗。");
  document.head.appendChild(script);
}

function setEditingState(isEditing) {
  document.body.classList.toggle("editing", isEditing);
  if (addBtn) {
    addBtn.textContent = isEditing ? "更新" : "新增";
  }
}

function startEdit(pinId) {
  if (!isAdmin()) {
    status("只有管理員可以修改資料。");
    return;
  }
  const pin = storePins.find((item) => item.id === pinId);
  if (!pin) {
    status("找不到要編輯的資料。");
    return;
  }
  editingId = pinId;
  nameInput.value = pin.name;
  addressInput.value = pin.address;
  setEditingState(true);
  status("已進入編輯模式。");
}

function cancelEdit(showStatus) {
  if (!editingId) {
    return;
  }
  editingId = null;
  form.reset();
  setEditingState(false);
  if (showStatus) {
    status("已取消編輯。");
  }
}

async function submitEdit() {
  if (!isAdmin()) {
    status("只有管理員可以修改資料。");
    return;
  }
  const name = nameInput.value.trim();
  const address = addressInput.value.trim();

  if (!name || !address) {
    status("請填寫店名與地址。");
    return;
  }

  if (existsPin(name, address, editingId)) {
    status("此店家已存在，不能重複新增。");
    return;
  }

  const pin = storePins.find((item) => item.id === editingId);
  if (!pin) {
    status("找不到要編輯的資料。");
    cancelEdit(false);
    return;
  }

  setBusy(true);
  try {
    let lat = pin.lat;
    let lng = pin.lng;
    if (normalize(pin.address) !== normalize(address)) {
      const coords = await geocodeAddress(address);
      if (!coords) {
        status("查無地址，請輸入更完整地址。");
        return;
      }
      lat = coords.lat;
      lng = coords.lng;
    }

    const updated = await updatePinById(editingId, {
      name,
      address,
      lat,
      lng,
    });
    if (!updated) {
      return;
    }
    renderAll();
    focusPin(editingId);
    cancelEdit(false);
    status("已更新資料。");
  } catch (err) {
    console.error(err);
    status("更新失敗，請稍後再試。");
  } finally {
    setBusy(false);
  }
}

function renderAll() {
  renderTable();
  renderMarkers();
}

function renderUsers() {
  if (!userTableBody) {
    return;
  }
  userTableBody.innerHTML = "";
  if (!isAdmin() || users.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.textContent = isAdmin() ? "尚無使用者帳號。" : "僅管理員可查看使用者清單。";
    row.appendChild(cell);
    userTableBody.appendChild(row);
    return;
  }

  users.forEach((user, index) => {
    const row = document.createElement("tr");
    const statusText = user.active ? "啟用" : "停用";
    const toggleLabel = user.active ? "停用" : "啟用";
    const lastLoginText = user.lastLoginAt ? formatDate(user.lastLoginAt) : "尚未登入";
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${escapeHtml(user.username)}</td>
      <td>${statusText}</td>
      <td>${formatDate(user.createdAt)}</td>
      <td>${lastLoginText}</td>
      <td>${formatLoginLocation(user)}</td>
      <td>
        <button data-action="toggle" data-id="${user.id}" class="ghost">${toggleLabel}</button>
        <button data-action="delete" data-id="${user.id}" class="danger">刪除</button>
      </td>
    `;
    userTableBody.appendChild(row);
  });
}

async function toggleUserActive(userId) {
  if (!isAdmin()) {
    status("只有管理員可以管理帳號。");
    return;
  }
  const user = users.find((item) => item.id === userId);
  if (!user) {
    return;
  }
  try {
    const data = await apiRequest("users:toggle", { id: userId });
    user.active = data.active;
  } catch (err) {
    console.error(err);
    status(err.message || "更新帳號狀態失敗。");
    return;
  }
  const effectiveActive = user.active;
  renderUsers();
  if (currentProfile && currentProfile.id === userId && !effectiveActive) {
    await handleUserLogout();
    status("帳號已停用，已登出。");
    return;
  }
  status(effectiveActive ? "已啟用帳號。" : "已停用帳號。");
}

async function deleteUser(userId) {
  if (!isAdmin()) {
    status("只有管理員可以管理帳號。");
    return;
  }
  const user = users.find((item) => item.id === userId);
  if (!user) {
    return;
  }
  if (!confirm(`確定要刪除帳號「${user.username}」嗎？`)) {
    return;
  }
  const success = await deleteUserAccount(userId);
  if (!success) {
    return;
  }
  users = users.filter((item) => item.id !== userId);
  renderUsers();
  if (currentProfile && currentProfile.id === userId) {
    await handleUserLogout();
    status("帳號已刪除，已登出。");
    return;
  }
  status("已刪除帳號。");
}

async function recordLoginLocation(profile) {
  if (!profile) {
    return;
  }
  const target = { ...profile };
  const loginAt = new Date();
  target.lastLoginAt = loginAt;
  target.lastLoginStatus = "定位中";
  updateLocalProfile(target);
  updateLoginInfo();

  if (!navigator.geolocation) {
    target.lastLoginStatus = "瀏覽器不支援定位";
    updateLocalProfile(target);
    updateLoginInfo();
    status("此瀏覽器不支援定位。");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      target.lastLoginLat = position.coords.latitude;
      target.lastLoginLng = position.coords.longitude;
      target.lastLoginAccuracy = position.coords.accuracy;
      target.lastLoginStatus = "OK";
      updateLocalProfile(target);
      try {
        await apiRequest("users:login_location", {
          lastLoginAt: loginAt.toISOString(),
          lastLoginLat: target.lastLoginLat,
          lastLoginLng: target.lastLoginLng,
          lastLoginAccuracy: target.lastLoginAccuracy,
          lastLoginStatus: target.lastLoginStatus,
        });
      } catch (err) {
        console.error(err);
      }
      updateLoginInfo();
      status("定位成功，已記錄登入位置。");
    },
    async (error) => {
      target.lastLoginLat = null;
      target.lastLoginLng = null;
      target.lastLoginAccuracy = null;
      target.lastLoginStatus = geolocationErrorMessage(error);
      updateLocalProfile(target);
      try {
        await apiRequest("users:login_location", {
          lastLoginAt: loginAt.toISOString(),
          lastLoginLat: null,
          lastLoginLng: null,
          lastLoginAccuracy: null,
          lastLoginStatus: target.lastLoginStatus,
        });
      } catch (err) {
        console.error(err);
      }
      updateLoginInfo();
      status(`定位失敗：${target.lastLoginStatus}`);
    },
    {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 30000,
    }
  );
}

function renderTable() {
  tableBody.innerHTML = "";
  if (storePins.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 7;
    cell.textContent = "目前沒有資料。";
    row.appendChild(cell);
    tableBody.appendChild(row);
    return;
  }

  storePins.forEach((pin, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
      <td>${escapeHtml(pin.name)}</td>
      <td>${escapeHtml(pin.address)}</td>
      <td>${pin.lat.toFixed(5)}</td>
      <td>${pin.lng.toFixed(5)}</td>
      <td>${formatDate(pin.createdAt)}</td>
      <td class="admin-only">
        <div class="table-actions-cell">
          <button data-action="edit" data-id="${pin.id}" class="ghost">編輯</button>
          <button data-action="delete" data-id="${pin.id}" class="danger">刪除</button>
        </div>
      </td>
    `;

    row.addEventListener("click", (evt) => {
      if (evt.target.closest("button")) {
        return;
      }
      focusPin(pin.id);
    });

    tableBody.appendChild(row);
  });

  tableBody.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      if (!isAdmin()) {
        status("只有管理員可以修改或刪除資料。");
        return;
      }
      const id = btn.getAttribute("data-id");
      const action = btn.getAttribute("data-action");
      if (action === "edit") {
        startEdit(id);
        return;
      }
      if (action === "delete") {
        deletePin(id);
      }
    });
  });
}

function renderMarkers() {
  if (!map) {
    return;
  }
  const currentIds = new Set(storePins.map((pin) => pin.id));

  markers.forEach((marker, id) => {
    if (!currentIds.has(id)) {
      marker.setMap(null);
      markers.delete(id);
    }
  });

  storePins.forEach((pin) => {
    if (markers.has(pin.id)) {
      const existingMarker = markers.get(pin.id);
      existingMarker.setPosition({ lat: pin.lat, lng: pin.lng });
      existingMarker.setTitle(pin.name);
      existingMarker.__pin = pin;
      return;
    }
    const marker = new google.maps.Marker({
      position: { lat: pin.lat, lng: pin.lng },
      map,
      title: pin.name,
    });
    marker.__pin = pin;
    marker.addListener("click", () => {
      if (!infoWindow) {
        return;
      }
      const data = marker.__pin || pin;
      infoWindow.setContent(buildPopupContent(data));
      infoWindow.open({ map, anchor: marker });
    });
    markers.set(pin.id, marker);
  });

  if (storePins.length > 0) {
    if (storePins.length === 1) {
      map.setCenter({ lat: storePins[0].lat, lng: storePins[0].lng });
      map.setZoom(15);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    storePins.forEach((pin) => bounds.extend({ lat: pin.lat, lng: pin.lng }));
    map.fitBounds(bounds, 80);
  }
}

function focusPin(id) {
  const pin = storePins.find((item) => item.id === id);
  if (!pin || !map) {
    return;
  }
  map.setCenter({ lat: pin.lat, lng: pin.lng });
  map.setZoom(15);
  const marker = markers.get(id);
  if (marker && infoWindow) {
    infoWindow.setContent(buildPopupContent(pin));
    infoWindow.open({ map, anchor: marker });
  }
}

async function deletePin(id) {
  const success = await deletePinById(id);
  if (!success) {
    return;
  }
  if (editingId === id) {
    cancelEdit(false);
  }
  status("已刪除資料。");
}

function exportCsv() {
  if (storePins.length === 0) {
    status("目前沒有資料可匯出。");
    return;
  }
  const headers = ["name", "address", "lat", "lng", "createdAt"];
  const rows = storePins.map((pin) => [
    pin.name,
    pin.address,
    pin.lat,
    pin.lng,
    (() => {
      const createdAt = toDateValue(pin.createdAt);
      return createdAt ? createdAt.toISOString() : "";
    })(),
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "store-pins.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  status("已匯出 CSV。");
}

async function importCsvText(text) {
  if (!authUser || !currentProfile) {
    status("請先登入才能匯入。");
    return;
  }
  const cleaned = text.replace(/^\uFEFF/, "");
  const rows = parseCsv(cleaned).map((row) => row.map((cell) => cell.trim()));
  const dataRows = rows.filter((row) => row.some((cell) => cell !== ""));
  if (dataRows.length === 0) {
    status("CSV 檔案內容為空。");
    return;
  }

  const headerIndex = buildHeaderIndex(dataRows[0]);
  const hasHeader = headerIndex.name !== undefined && headerIndex.address !== undefined;

  const nameIdx = hasHeader ? headerIndex.name : 0;
  const addressIdx = hasHeader ? headerIndex.address : 1;
  const latIdx = hasHeader ? headerIndex.lat : 2;
  const lngIdx = hasHeader ? headerIndex.lng : 3;
  const createdIdx = hasHeader ? headerIndex.createdAt : 4;

  let added = 0;
  let skipped = 0;
  let failed = 0;
  let geocoded = 0;

  for (let i = hasHeader ? 1 : 0; i < dataRows.length; i += 1) {
    const row = dataRows[i];
    const name = (row[nameIdx] || "").trim();
    let address = (row[addressIdx] || "").trim();

    if (!name || !address) {
      failed += 1;
      continue;
    }

    if (existsPin(name, address)) {
      skipped += 1;
      continue;
    }

    let lat = Number.parseFloat((row[latIdx] || "").trim());
    let lng = Number.parseFloat((row[lngIdx] || "").trim());
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      const coords = await geocodeAddress(address);
      if (!coords) {
        failed += 1;
        continue;
      }
      lat = coords.lat;
      lng = coords.lng;
      geocoded += 1;
      await sleep(900);
    }

    const createdAt = normalizeDate(row[createdIdx]);
    const pin = await insertPin({
      name,
      address,
      lat,
      lng,
      createdAt,
    });
    if (pin) {
      added += 1;
    } else {
      failed += 1;
    }
  }

  if (added > 0) {
    renderAll();
  }

  const summary = `匯入完成：新增 ${added} 筆，略過 ${skipped} 筆，失敗 ${failed} 筆。`;
  status(geocoded > 0 ? `${summary}（已補座標 ${geocoded} 筆）` : summary);
}

function existsPin(name, address, excludeId) {
  const nameKey = normalize(name);
  const addressKey = normalize(address);
  return storePins.some(
    (pin) =>
      pin.id !== excludeId &&
      normalize(pin.name) === nameKey &&
      normalize(pin.address) === addressKey
  );
}

function normalize(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

async function geocodeAddress(address) {
  if (window.google && google.maps && google.maps.Geocoder) {
    if (!map) {
      await Promise.race([mapReady, sleep(3000)]);
    }
    const geocoder = new google.maps.Geocoder();
    const request = {
      address,
      region: "TW",
    };
    if (map && typeof map.getBounds === "function") {
      const bounds = map.getBounds();
      if (bounds) {
        request.bounds = bounds;
      }
    }
    const result = await new Promise((resolve) => {
      geocoder.geocode(request, (results, geocodeStatus) => {
        if (geocodeStatus === "OK" && results && results[0]) {
          resolve(results[0]);
        } else if (geocodeStatus === "ZERO_RESULTS") {
          resolve(null);
        } else {
          const message = mapGeocodeStatus(geocodeStatus);
          if (message) {
            status(`地理編碼失敗：${message}`);
          }
          resolve(null);
        }
      });
    });
    if (!result) {
      return null;
    }
    const location = result.geometry && result.geometry.location;
    if (!location) {
      return null;
    }
    return {
      lat: typeof location.lat === "function" ? location.lat() : Number(location.lat),
      lng: typeof location.lng === "function" ? location.lng() : Number(location.lng),
    };
  }

  if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === "YOUR_GOOGLE_MAPS_API_KEY") {
    status("請先設定 Google Maps API Key。");
    throw new Error("Missing Google Maps API key");
  }

  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", GOOGLE_MAPS_API_KEY);
  url.searchParams.set("language", "zh-TW");
  url.searchParams.set("region", "TW");
  if (map && typeof map.getBounds === "function") {
    const bounds = map.getBounds();
    if (bounds) {
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      if (sw && ne) {
        url.searchParams.set(
          "bounds",
          `${sw.lat()},${sw.lng()}|${ne.lat()},${ne.lng()}`
        );
      }
    }
  }
  const response = await fetch(url.toString());
  if (!response.ok) {
    status("地理編碼失敗：網路或服務異常");
    return null;
  }
  const data = await response.json();
  if (data.status !== "OK" || !Array.isArray(data.results) || data.results.length === 0) {
    if (data.status && data.status !== "ZERO_RESULTS") {
      const message = data.error_message
        ? `${data.status}：${data.error_message}`
        : data.status;
      status(`地理編碼失敗：${message}`);
    }
    return null;
  }
  const location = data.results[0]?.geometry?.location;
  if (!location) {
    return null;
  }
  return {
    lat: Number(location.lat),
    lng: Number(location.lng),
  };
}

function status(message) {
  statusEl.textContent = message;
}

function setBusy(isBusy) {
  form.querySelectorAll("input, button").forEach((el) => {
    el.disabled = isBusy;
  });
  if (!isBusy) {
    applyPermissionState();
  }
}

function setActionBusy(isBusy) {
  [exportBtn, importBtn, clearBtn].forEach((btn) => {
    if (btn) {
      btn.disabled = isBusy;
    }
  });
  if (!isBusy) {
    applyPermissionState();
  }
}

function toDateValue(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (typeof value.seconds === "number") {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function formatDate(value) {
  const date = toDateValue(value);
  if (!date) {
    return "";
  }
  return date.toLocaleString();
}

function mapGeocodeStatus(status) {
  if (!status) {
    return "";
  }
  if (status === "REQUEST_DENIED") {
    return "請確認已啟用 Geocoding API 並開啟計費";
  }
  if (status === "OVER_QUERY_LIMIT") {
    return "已超過 API 使用量限制";
  }
  if (status === "INVALID_REQUEST") {
    return "請輸入完整地址";
  }
  if (status === "UNKNOWN_ERROR") {
    return "服務暫時不可用，請稍後再試";
  }
  return status;
}

function getMapCenterCoords() {
  if (!map || typeof map.getCenter !== "function") {
    return null;
  }
  const center = map.getCenter();
  if (!center) {
    return null;
  }
  const lat = typeof center.lat === "function" ? center.lat() : Number(center.lat);
  const lng = typeof center.lng === "function" ? center.lng() : Number(center.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { lat, lng };
}

async function resolveCoordsForAdd(address) {
  const coords = await geocodeAddress(address);
  if (coords) {
    return coords;
  }
  const center = getMapCenterCoords();
  if (!center) {
    status("查無地址，請輸入更完整地址。");
    return null;
  }
  const useCenter = confirm("查無地址或地理編碼失敗，是否改用地圖中心座標新增？");
  if (!useCenter) {
    return null;
  }
  return center;
}

function formatLoginLocation(user) {
  if (!user.lastLoginAt) {
    return "尚未登入";
  }
  if (user.lastLoginStatus !== "OK") {
    return user.lastLoginStatus || "定位失敗";
  }
  if (!Number.isFinite(user.lastLoginLat) || !Number.isFinite(user.lastLoginLng)) {
    return "定位失敗";
  }
  const latText = user.lastLoginLat.toFixed(5);
  const lngText = user.lastLoginLng.toFixed(5);
  const accuracyText = Number.isFinite(user.lastLoginAccuracy)
    ? `（±${Math.round(user.lastLoginAccuracy)}m）`
    : "";
  return `${latText}, ${lngText}${accuracyText}`;
}

function updateLoginInfo() {
  if (!loginInfoUser || !loginInfoTime || !loginInfoLocation || !loginInfoStatus) {
    return;
  }
  if (!currentProfile) {
    loginInfoUser.textContent = "尚未登入";
    loginInfoTime.textContent = "—";
    loginInfoLocation.textContent = "—";
    loginInfoStatus.textContent = "—";
    return;
  }
  loginInfoUser.textContent = currentProfile.username;
  loginInfoTime.textContent = currentProfile.lastLoginAt
    ? formatDate(currentProfile.lastLoginAt)
    : "尚未登入";
  loginInfoLocation.textContent = formatLoginLocation(currentProfile);
  loginInfoStatus.textContent = currentProfile.lastLoginStatus || "—";
}

function geolocationErrorMessage(error) {
  if (!error || typeof error.code !== "number") {
    return "定位失敗";
  }
  if (error.code === 1) {
    return "使用者拒絕定位";
  }
  if (error.code === 2) {
    return "定位資訊不可用";
  }
  if (error.code === 3) {
    return "定位逾時";
  }
  return "定位失敗";
}

function normalizeDate(value) {
  const raw = (value || "").toString().trim();
  if (!raw) {
    return new Date().toISOString();
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPopupContent(pin) {
  return `<strong>${escapeHtml(pin.name)}</strong><br />${escapeHtml(pin.address)}`;
}

function csvEscape(value) {
  const raw = value === null || value === undefined ? "" : String(value);
  if (/[\",\n\r]/.test(raw)) {
    return `"${raw.replace(/\"/g, "\"\"")}"`;
  }
  return raw;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === "\"") {
        if (text[i + 1] === "\"") {
          field += "\"";
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else {
      if (char === "\"") {
        inQuotes = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (char === "\r") {
        if (text[i + 1] === "\n") {
          i += 1;
        }
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += char;
      }
    }
  }

  row.push(field);
  rows.push(row);

  if (rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    if (lastRow.length === 1 && lastRow[0] === "") {
      rows.pop();
    }
  }

  return rows;
}

function buildHeaderIndex(headerRow) {
  const headerMap = {};
  headerRow.forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    if (HEADER_ALIASES[normalized]) {
      headerMap[HEADER_ALIASES[normalized]] = index;
    }
  });
  return headerMap;
}

function normalizeHeader(value) {
  return (value || "")
    .toString()
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const HEADER_ALIASES = {
  name: "name",
  storename: "name",
  店名: "name",
  店家: "name",
  商家: "name",
  address: "address",
  地址: "address",
  location: "address",
  lat: "lat",
  latitude: "lat",
  緯度: "lat",
  lng: "lng",
  lon: "lng",
  longitude: "lng",
  經度: "lng",
  createdat: "createdAt",
  created_at: "createdAt",
  created: "createdAt",
  date: "createdAt",
  新增時間: "createdAt",
  時間: "createdAt",
};

window.initMap = initMap;
loadGoogleMaps();
