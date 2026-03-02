let lastPressure = null;
let isRefreshing = false;

function getLocationAndWeather() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                fetchWeather(`${lat},${lon}`);
            },
            (error) => {
                console.error("Geolocation failed or denied, using auto:ip", error);
                fetchWeather("auto:ip");
            }
        );
    } else {
        console.warn("Geolocation is not supported by this browser, using auto:ip");
        fetchWeather("auto:ip");
    }
}

async function fetchWeather(query) {
    try {
        const baseURL = import.meta.env.VITE_API_URL || '';
        const res = await fetch(`${baseURL}/api/weather?q=${query}`);
        const data = await res.json();

        if (data && data.current) {
            window.currentLat = data.location.lat;
            window.currentLon = data.location.lon;

            updateUI(data);

            await Promise.all([
                generateForecastAI(data),
                fetchExtendedForecast(data.location.lat, data.location.lon),
                initRadar(data.location.lat, data.location.lon)
            ]);

            if (isRefreshing) {
                document.getElementById('loading-screen').style.display = 'none';
                isRefreshing = false;
                if (radarMap) {
                    radarMap.invalidateSize();
                }
            } else {
                showEnterButton();
            }
        } else {
            console.error('Weather data not found', data);
            document.getElementById('loading-text').innerText = "ERROR LOADING DATA";
        }
    } catch (e) {
        console.error('Error fetching weather:', e);
        document.getElementById('loading-text').innerText = "ERROR LOADING DATA";
    }
}

function showEnterButton() {
    const loadingText = document.getElementById('loading-text');
    const enterBtn = document.getElementById('enter-button');
    if (loadingText && enterBtn) {
        loadingText.style.display = 'none';
        enterBtn.style.display = 'inline-block';
    }
}

async function generateForecastAI(data) {
    try {
        const current = data.current;
        const forecast = data.forecast.forecastday[0].day;
        const astro = data.forecast.forecastday[0].astro;

        // Calculate pressure trend string
        let pressureTrendStr = "STEADY";
        if (lastPressure !== null) {
            if (current.pressure_mb > lastPressure) pressureTrendStr = "RISING";
            else if (current.pressure_mb < lastPressure) pressureTrendStr = "FALLING";
        }

        // Format date and time for last update
        const dateObj = new Date(current.last_updated);
        const timeOptions = { hour: 'numeric', minute: '2-digit', hour12: true };
        const dateOptions = { month: 'short', day: 'numeric', year: 'numeric' };
        const lastUpdatedFormatted = `${dateObj.toLocaleTimeString('en-US', timeOptions)} ON ${dateObj.toLocaleDateString('en-US', dateOptions).toUpperCase()}`;

        const weatherDetails = `
            Last Update: ${lastUpdatedFormatted}
            City: ${data.location.name}
            Condition: ${current.condition.text}
            Current Temp: ${Math.round(current.temp_f)}F
            Feels Like: ${Math.round(current.feelslike_f)}F
            Today High: ${Math.round(forecast.maxtemp_f)}F  
            Today Low: ${Math.round(forecast.mintemp_f)}F
            Wind: ${current.wind_dir} at ${Math.round(current.wind_mph)} MPH
            Chance of Rain: ${forecast.daily_chance_of_rain}%
            Pressure Trend: ${pressureTrendStr}
            Sunrise: ${astro.sunrise}
            Sunset: ${astro.sunset}
            Active Alerts: ${JSON.stringify(data.alerts || "No active alerts")}
        `;

        const baseURL = import.meta.env.VITE_API_URL || '';
        const aiResponse = await fetch(`${baseURL}/api/generate-forecast`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ weatherDetails })
        });

        const aiData = await aiResponse.json();

        if (aiData.forecast) {
            window.forecastAI = aiData.forecast;

            // Apply crawl text
            const ticker = document.querySelector('.ticker');
            if (ticker && aiData.forecast.crawl) {
                ticker.innerText = aiData.forecast.crawl;
            }

            // Apply severe weather background color
            const bottomBar = document.querySelector('.bottom-bar');
            if (bottomBar) {
                if (aiData.forecast.hasSevereAlerts) {
                    bottomBar.classList.add('severe');
                } else {
                    bottomBar.classList.remove('severe');
                }
            }
        } else {
            console.error('API Error:', aiData.error);
        }

    } catch (error) {
        console.error('Error generating AI forecast:', error);
    }
}

async function fetchExtendedForecast(lat, lon) {
    try {
        const baseURL = import.meta.env.VITE_API_URL || '';
        const res = await fetch(`${baseURL}/api/extended-forecast?lat=${lat}&lon=${lon}`);
        const data = await res.json();

        if (data && data.daily) {
            updateExtendedUI(data.daily);
        }
    } catch (e) {
        console.error('Error fetching extended forecast:', e);
    }
}

function updateExtendedUI(daily) {
    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

    // Indices 2, 3, 4 correspond to day+2, day+3, day+4 (skipping today and tomorrow)
    for (let i = 2; i <= 4; i++) {
        const dateStr = daily.time[i];
        const dateObj = new Date(dateStr + "T12:00:00"); // midday avoid timezone shift
        const dayName = days[dateObj.getDay()];

        const hi = Math.round(daily.temperature_2m_max[i]);
        const lo = Math.round(daily.temperature_2m_min[i]);
        const code = daily.weathercode[i];

        const { desc, icon } = mapWeatherCode(code);

        const colId = i - 1; // map to ext-day1, ext-day2, ext-day3
        const col = document.getElementById(`ext-day${colId}`);
        if (col) {
            col.querySelector('.ext-day-title').innerText = dayName;
            col.querySelector('.ext-icon').src = icon;
            col.querySelector('.ext-desc').innerHTML = desc;
            col.querySelector('.lo-val').innerText = lo;
            col.querySelector('.hi-val').innerText = hi;
        }
    }
}

function mapWeatherCode(code) {
    let desc = "Clear";
    let icon = "clear-day";

    if (code === 0) { desc = "Clear"; icon = "clear-day"; }
    else if (code === 1 || code === 2) { desc = "Partly<br>Cloudy"; icon = "partly-cloudy-day"; }
    else if (code === 3) { desc = "Cloudy"; icon = "cloudy"; }
    else if (code >= 45 && code <= 48) { desc = "Fog"; icon = "fog"; }
    else if (code >= 51 && code <= 55) { desc = "Drizzle"; icon = "drizzle"; }
    else if (code >= 61 && code <= 65) { desc = "Rain"; icon = "rain"; }
    else if (code >= 71 && code <= 75) { desc = "Snow"; icon = "snow"; }
    else if (code >= 80 && code <= 82) { desc = "Showers"; icon = "rain"; }
    else if (code >= 95 && code <= 99) { desc = "Scattered<br>T'Storms"; icon = "thunderstorms-day"; }

    return { desc, icon: `https://basmilius.github.io/weather-icons/production/fill/all/${icon}.svg` };
}

function getAnimatedIcon(code, isDay) {
    let iconName = isDay ? "clear-day" : "clear-night";

    const dayNightPrefix = isDay ? "day" : "night";

    switch (code) {
        case 1000: iconName = isDay ? "clear-day" : "clear-night"; break;
        case 1003: iconName = isDay ? "partly-cloudy-day" : "partly-cloudy-night"; break;
        case 1006: iconName = "cloudy"; break;
        case 1009: iconName = "overcast"; break;
        case 1030: iconName = "mist"; break;
        case 1063: iconName = isDay ? "partly-cloudy-day-drizzle" : "partly-cloudy-night-drizzle"; break;
        case 1066: iconName = isDay ? "partly-cloudy-day-snow" : "partly-cloudy-night-snow"; break;
        case 1069: iconName = isDay ? "partly-cloudy-day-sleet" : "partly-cloudy-night-sleet"; break;
        case 1072: iconName = "drizzle"; break;
        case 1087: iconName = isDay ? "thunderstorms-day" : "thunderstorms-night"; break;
        case 1114: iconName = "snow"; break;
        case 1117: iconName = "extreme-snow"; break;
        case 1135: iconName = "fog"; break;
        case 1148: iconName = "fog"; break;
        case 1150: case 1153: case 1168: case 1171: iconName = "drizzle"; break;
        case 1180: case 1186: iconName = isDay ? "partly-cloudy-day-rain" : "partly-cloudy-night-rain"; break;
        case 1183: case 1189: case 1192: case 1195: iconName = "rain"; break;
        case 1198: case 1201: case 1204: case 1207: iconName = "sleet"; break;
        case 1210: case 1216: iconName = isDay ? "partly-cloudy-day-snow" : "partly-cloudy-night-snow"; break;
        case 1213: case 1219: case 1222: case 1225: iconName = "snow"; break;
        case 1237: iconName = "sleet"; break;
        case 1240: case 1243: case 1246: iconName = "rain"; break;
        case 1249: case 1252: iconName = "sleet"; break;
        case 1255: case 1258: iconName = "snow"; break;
        case 1261: case 1264: iconName = "sleet"; break;
        case 1273: case 1276: iconName = "thunderstorms-rain"; break;
        case 1279: case 1282: iconName = "thunderstorms-snow"; break;
    }

    return `https://basmilius.github.io/weather-icons/production/fill/all/${iconName}.svg`;
}

function updateUI(data) {
    const current = data.current;

    // Update City
    document.getElementById('city').innerText = data.location.name;

    // Update main temp and conditions
    document.getElementById('temp').innerText = Math.round(current.temp_f);
    document.getElementById('condition').innerText = current.condition.text;

    // Update Icon - Animated Meteocons mapping
    document.getElementById('weather-icon').src = getAnimatedIcon(current.condition.code, current.is_day);

    // Right column data
    document.getElementById('humidity').innerText = `${current.humidity}%`;

    // Calculate dewpoint (Magnus-Tetens formula)
    let tempC = current.temp_c;
    let rh = current.humidity;
    let a = 17.27;
    let b = 237.7;
    let alpha = ((a * tempC) / (b + tempC)) + Math.log(rh / 100.0);
    let dewC = (b * alpha) / (a - alpha);
    let dewF = Math.round((dewC * 9 / 5) + 32);
    document.getElementById('dewpoint').innerText = `${dewF}°`;

    // Ceiling (if cloud cover is < 30, it's unlimited, else calculate a base)
    let cloud = current.cloud;
    let ceilingText = "Unlimited";
    if (cloud > 30) {
        ceilingText = `${Math.max(10, 100 - cloud)}00 ft`;
    }
    if (current.vis_miles < 3) {
        ceilingText = "200 ft"; // low visibility usually means low ceiling
    }
    if (ceilingText === "Unlimited") {
        document.getElementById('ceiling').innerText = "Unlimited";
    } else {
        document.getElementById('ceiling').innerText = ceilingText;
    }

    // Visibility
    document.getElementById('visibility').innerText = `${current.vis_miles} mi.`;

    // Wind
    document.getElementById('wind').innerText = `${current.wind_dir} ${Math.round(current.wind_mph)}`;

    // Pressure with indicator
    let pressureIn = current.pressure_in.toFixed(2);
    let indicator = "";
    if (lastPressure !== null) {
        if (current.pressure_mb > lastPressure) indicator = "↑";
        else if (current.pressure_mb < lastPressure) indicator = "↓";
        else indicator = "S";
    } else {
        indicator = "S"; // Steady on first load unless we have history
    }
    lastPressure = current.pressure_mb;
    document.getElementById('pressure').innerText = `${pressureIn} ${indicator}`;

    // Bottom Bar
    document.getElementById('bottom-temp').innerHTML = `Temp: ${Math.round(current.temp_f)}&deg;F`;
}

// Clock functionality
function updateClock() {
    const now = new Date();

    let hours = now.getHours();
    let minutes = now.getMinutes().toString().padStart(2, '0');
    let seconds = now.getSeconds().toString().padStart(2, '0');
    let ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    document.getElementById('time').innerHTML = `${hours}:${minutes}:${seconds} <span class="ampm">${ampm}</span>`;

    const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

    let day = days[now.getDay()];
    let month = months[now.getMonth()];
    let date = now.getDate();

    document.getElementById('date').innerText = `${day} ${month} ${date}`;
}

let currentScreenIndex = -1;
let screensToCycle = [];

function toggleScreens() {
    const currentHour = new Date().getHours();
    screensToCycle = ['current', 'today'];

    // Only show "Tonight" if it's before 4 PM (16:00)
    if (currentHour < 16) {
        screensToCycle.push('tonight');
    }

    screensToCycle.push('tomorrow');
    screensToCycle.push('extended');
    screensToCycle.push('radar');

    currentScreenIndex = (currentScreenIndex + 1) % screensToCycle.length;
    const activeScreen = screensToCycle[currentScreenIndex];

    const titleElement = document.getElementById('page-title');
    const sections = {
        'current': document.getElementById('current-conditions-content'),
        'today': document.getElementById('forecast-today-content'),
        'tonight': document.getElementById('forecast-tonight-content'),
        'tomorrow': document.getElementById('forecast-tomorrow-content'),
        'extended': document.getElementById('extended-forecast-content'),
        'radar': document.getElementById('radar-content')
    };

    // Hide all
    Object.values(sections).forEach(s => { if (s) s.style.display = 'none'; });

    const precipLegend = document.getElementById('precip-legend');
    const timeArea = document.getElementById('time-area');
    if (precipLegend) precipLegend.style.display = 'none';
    if (timeArea) timeArea.style.display = 'flex';

    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const tomorrowName = days[(new Date().getDay() + 1) % 7];

    const mainBox = document.querySelector('.main-box');
    mainBox.style.display = 'block';
    mainBox.classList.remove('no-bg', 'radar-bg');

    if (activeScreen === 'current') {
        titleElement.innerHTML = 'Current<br>Conditions';
        if (sections['current']) sections['current'].style.display = 'block';
    }
    else if (activeScreen === 'today') {
        titleElement.innerHTML = 'Local<br>Forecast';
        if (sections['today']) sections['today'].style.display = 'block';
        const txt = window.forecastAI ? window.forecastAI.today : '';
        document.getElementById('text-today').innerHTML = `<p>${txt}</p>`;
    }
    else if (activeScreen === 'tonight') {
        titleElement.innerHTML = 'Local<br>Forecast';
        if (sections['tonight']) sections['tonight'].style.display = 'block';
        // Add "TONIGHT..." if the AI didn't start with it
        let txt = window.forecastAI ? window.forecastAI.tonight : '';
        if (txt && !txt.startsWith('TONIGHT')) txt = `TONIGHT... ${txt}`;
        document.getElementById('text-tonight').innerHTML = `<p>${txt}</p>`;
    }
    else if (activeScreen === 'tomorrow') {
        titleElement.innerHTML = 'Local<br>Forecast';
        if (sections['tomorrow']) sections['tomorrow'].style.display = 'block';
        // Dynamically add Tomorrow's day name
        let txt = window.forecastAI ? window.forecastAI.tomorrow : '';
        if (txt) {
            // Strip out "TOMORROW..." if the AI provided it, so we don't have "SATURDAY... TOMORROW..."
            txt = txt.replace(/^TOMORROW[\.\s]*/i, '');
            if (!txt.startsWith(tomorrowName)) {
                // Only add the ellipsis if the AI text doesn't already start with one
                txt = txt.startsWith('...') ? `${tomorrowName}${txt}` : `${tomorrowName}... ${txt}`;
            }
        }
        document.getElementById('text-tomorrow').innerHTML = `<p>${txt}</p>`;
    }
    else if (activeScreen === 'extended') {
        titleElement.innerHTML = 'Extended<br>Forecast';
        if (sections['extended']) sections['extended'].style.display = 'block';
        document.querySelector('.main-box').classList.add('no-bg');
    }
    else if (activeScreen === 'radar') {
        titleElement.innerHTML = 'Local<br>Radar';
        if (sections['radar']) sections['radar'].style.display = 'block';
        mainBox.classList.add('radar-bg');
        if (precipLegend) precipLegend.style.display = 'flex';
        if (timeArea) timeArea.style.display = 'none';

        if (radarMap) {
            radarMap.invalidateSize();
        }
    }
}

let radarMap = null;
let radarLayers = [];
let currentRadarFrame = 0;

async function initRadar(lat, lon) {
    if (radarMap) {
        return;
    }

    // Initialize Leaflet map with all interactions disabled
    radarMap = L.map('radar-map', {
        zoomControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false
    }).setView([lat, lon], 7);

    // Apply CartoDB Positron No Labels tile layer for the retro base
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
        maxZoom: 19
    }).addTo(radarMap);

    await Promise.all([
        fetchNearbyCities(lat, lon),
        fetchRainviewerData(lat, lon)
    ]);
}

async function fetchNearbyCities(lat, lon) {
    try {
        const baseURL = import.meta.env.VITE_API_URL || '';
        const res = await fetch(`${baseURL}/api/radar-cities?lat=${lat}&lon=${lon}`);
        const data = await res.json();

        if (data && data.elements) {
            data.elements.forEach(el => {
                if (el.tags && el.tags.name) {
                    let cityName = el.tags.name.toUpperCase();
                    if (cityName.length > 12) cityName = cityName.substring(0, 12);
                    const labelIcon = L.divIcon({
                        className: 'radar-city-label',
                        html: cityName,
                        iconSize: [120, 20],
                        iconAnchor: [60, 10]
                    });
                    L.marker([el.lat, el.lon], { icon: labelIcon }).addTo(radarMap);
                }
            });
        }
    } catch (e) {
        console.error("Error fetching nearby cities for radar:", e);
    }
}

let currentFrame = 0;
let radarInterval = null;

async function fetchRainviewerData(lat, lon) {
    try {
        // Clear previous layers + interval
        if (radarInterval) {
            clearInterval(radarInterval);
            radarInterval = null;
        }

        radarLayers.forEach(layer => radarMap.removeLayer(layer));
        radarLayers = [];
        currentFrame = 0;

        const baseURL = import.meta.env.VITE_API_URL || '';
        const res = await fetch(`${baseURL}/api/radar-frames`);
        const data = await res.json();

        if (!data?.radar?.past) return;

        // Use fewer frames for classic broadcast feel
        const frames = data.radar.past.slice(-6);

        frames.forEach(frame => {
            const url = `https://tilecache.rainviewer.com/v2/radar/${frame.time}/256/{z}/{x}/{y}/2/1_1.png`;

            const tileLayer = L.tileLayer(url, {
                opacity: 0,
                zIndex: 10,
                pane: 'overlayPane'
            });

            tileLayer.addTo(radarMap);
            radarLayers.push(tileLayer);
        });

        if (radarLayers.length === 0) return;

        // Show first frame immediately
        radarLayers[0].setOpacity(0.7);

        radarInterval = setInterval(() => {
            radarLayers[currentFrame].setOpacity(0);

            currentFrame = (currentFrame + 1) % radarLayers.length;

            radarLayers[currentFrame].setOpacity(0.7);
        }, 1100); // slower for 90s vibe

    } catch (e) {
        console.error("Error fetching RainViewer data:", e);
    }
}

function animateRadar() {
    if (radarLayers.length === 0) return;
    radarLayers[currentRadarFrame].setOpacity(0);
    currentRadarFrame = (currentRadarFrame + 1) % radarLayers.length;
    radarLayers[currentRadarFrame].setOpacity(0.65);
}

// --- Music Player ---
const playlist = [
    'music/jazz1.mp3',
    'music/jazz2.mp3',
    'music/jazz3.mp3',
    'music/jazz4.mp3',
    'music/jazz5.mp3',
    'music/jazz6.mp3',
    'music/jazz7.mp3',
    'music/jazz8.mp3',
    'music/jazz9.mp3',
    'music/jazz10.mp3',
    'music/jazz11.mp3',
    'music/jazz12.mp3',
    'music/jazz13.mp3',
    'music/jazz14.mp3',
    'music/jazz15.mp3',
    'music/jazz16.mp3',
    'music/jazz17.mp3',
    'music/jazz18.mp3'
];

let currentSongIndex = 0;
let audioPlayer = new Audio();

function shufflePlaylist(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
}

function playNextSong() {
    if (currentSongIndex >= playlist.length) {
        currentSongIndex = 0;
        shufflePlaylist(playlist);
    }
    audioPlayer.src = playlist[currentSongIndex];
    audioPlayer.play().catch(e => {
        console.log("Autoplay blocked. User interaction required to play music.", e);
    });
    currentSongIndex++;
}

audioPlayer.addEventListener('ended', playNextSong);

function initMusic() {
    shufflePlaylist(playlist);
    playNextSong();
}

// Initialization
setInterval(updateClock, 1000);
updateClock();
getLocationAndWeather();

function refreshData() {
    isRefreshing = true;
    getLocationAndWeather();
}

setInterval(refreshData, 15 * 60 * 1000);

document.getElementById('enter-button').addEventListener('click', () => {
    document.getElementById('loading-screen').style.display = 'none';
    initMusic();
    if (radarMap) {
        radarMap.invalidateSize();
    }
    toggleScreens();
    setInterval(toggleScreens, 10000);
});

// --- TV Scaling ---
function fitScreenToTV() {
    const screenContainer = document.querySelector('.screen-container');
    const tvBounds = document.querySelector('.tv-screen-bounds');

    if (screenContainer && tvBounds) {
        const boundsWidth = tvBounds.clientWidth;
        const boundsHeight = tvBounds.clientHeight;

        const originalWidth = 800;
        const originalHeight = 600;

        const scaleX = boundsWidth / originalWidth;
        const scaleY = boundsHeight / originalHeight;

        if (window.innerWidth <= 900) {
            // Keep aspect ratio strictly and center it on portrait/mobile
            const scale = Math.min(scaleX, scaleY);
            screenContainer.style.transformOrigin = 'center center';
            screenContainer.style.position = 'absolute';
            screenContainer.style.top = '50%';
            screenContainer.style.left = '50%';
            screenContainer.style.transform = `translate(-50%, -50%) scale(${scale})`;
        } else {
            // Stretch to fit the CRT boundaries on desktop
            screenContainer.style.transformOrigin = 'top left';
            screenContainer.style.top = '0';
            screenContainer.style.left = '0';
            screenContainer.style.transform = `scale(${scaleX}, ${scaleY})`;
        }
    }
}

window.addEventListener('resize', fitScreenToTV);
// Delay initially to ensure images map first for flexbox
setTimeout(fitScreenToTV, 100);
