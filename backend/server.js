const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 8080;

const allowedOrigins = [
    /^https?:\/\/(?:[a-z0-9-]+\.)*jeremymack\.com$/i, // jeremymack.com and subdomains
    /^http:\/\/localhost(:\d+)?$/i // Local development
];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps, curl, or server-to-server)
        if (!origin || allowedOrigins.some(pattern => pattern.test(origin))) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['*']
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'dist')));
app.use(express.static(path.join(__dirname, '..')));

// Weather Endpoint
app.get('/api/weather', async (req, res) => {
    try {
        const WEATHER_API_KEY = process.env.WEATHER_API_KEY;
        const query = req.query.q;
        if (!query) {
            return res.status(400).json({ error: 'Query parameter "q" is required' });
        }

        const weatherRes = await fetch(`https://api.weatherapi.com/v1/forecast.json?key=${WEATHER_API_KEY}&q=${query}&days=1&alerts=yes`);
        const data = await weatherRes.json();
        if (data.error) {
            console.error('WeatherAPI Error:', data.error);
        }
        res.json(data);
    } catch (error) {
        console.error('Error fetching weather:', error);
        res.status(500).json({ error: 'Failed to fetch weather data', details: error.message });
    }
});

// OpenAI Forecast Endpoint
app.post('/api/generate-forecast', async (req, res) => {
    try {
        const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
        const { weatherDetails } = req.body;
        if (!weatherDetails) {
            return res.status(400).json({ error: 'weatherDetails is required' });
        }

        const prompt = `You are a script writer for the 1990s WeatherStar 4000 local forecast broadcast. 
        Write strictly formatted regional forecasts based on these conditions:
        ${weatherDetails}

        Rules for Forecast (today, tonight, tomorrow):
        1. Write complete sentences for the forecast.
        2. Format all text in ALL CAPS.
        3. Do NOT replace normal periods with ellipses.
        4. The ONLY place you should use an ellipsis '...' is immediately following the day or time indicator at the very beginning of the text, if you choose to include one (e.g. 'TONIGHT... EXPECT RAIN.', 'SATURDAY... CLEAR SKIES.').

        Rules for Crawl (crawl message at the bottom of the screen):
        1. Format all text in ALL CAPS.
        2. String together these items using '  ' as separators:
           Last update time   Pressure trend (RISING / FALLING / STEADY)  Sunrise and sunset times  Feels like temperature (Wind Chill / Heat Index) if notable   Regional coverage statement (e.g., COVERAGE WITHIN 100 MILES OF [CITY])  Severe weather interruption notice ("SEVERE WEATHER WILL INTERRUPT PROGRAMMING") *ONLY* if there are severe weather alerts  Active weather alerts (only when present).

        CRITICAL: Output ONLY raw JSON. Do not include any formatting, text, headers, markdown tags (like \`\`\`json), or anything outside of the JSON brackets. Return this exact structure:
        {
          "today": "(general forecast for today)",
          "tonight": "(forecast for tonight)",
          "tomorrow": "(forecast for tomorrow)",
          "crawl": "(the continuous string of data separated by ellipses)",
          "hasSevereAlerts": true/false
        }`;

        const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                response_format: { type: "json_object" },
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 350,
                temperature: 0.3
            })
        });

        const aiData = await aiResponse.json();

        if (aiData.error) {
            console.error("OpenAI API Error:", aiData.error);
            return res.status(500).json({ error: aiData.error.message });
        }

        if (aiData.choices && aiData.choices.length > 0) {
            let aiText = aiData.choices[0].message.content.trim();
            console.log("Raw API Output Received From OpenAI:", aiText);
            try {
                const parsedForecast = JSON.parse(aiText);
                res.json({ forecast: parsedForecast });
            } catch (e) {
                console.error("Failed to parse OpenAI JSON response:", aiText);
                res.status(500).json({ error: 'Failed to parse forecast' });
            }
        } else {
            res.status(500).json({ error: 'No forecast generated' });
        }
    } catch (error) {
        console.error('Error generating AI forecast:', error);
        res.status(500).json({ error: 'Failed to generate forecast' });
    }
});

// Extended Forecast Endpoint
app.get('/api/extended-forecast', async (req, res) => {
    try {
        const { lat, lon } = req.query;
        if (!lat || !lon) {
            return res.status(400).json({ error: 'lat and lon are required' });
        }

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto&forecast_days=6`;
        const fetchRes = await fetch(url);
        const data = await fetchRes.json();
        res.json(data);
    } catch (error) {
        console.error('Error fetching extended forecast:', error);
        res.status(500).json({ error: 'Failed to fetch extended forecast' });
    }
});

// Overpass API Proxy
app.get('/api/radar-cities', async (req, res) => {
    try {
        const { lat, lon } = req.query;
        if (!lat || !lon) return res.status(400).json({ error: 'lat and lon required' });

        const query = `[out:json];node(around:250000,${lat},${lon})["place"="city"];out 6;`;
        const overpassRes = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
        const data = await overpassRes.json();
        res.json(data);
    } catch (error) {
        console.error('Error fetching nearby cities:', error);
        res.status(500).json({ error: 'Failed to fetch cities' });
    }
});

// RainViewer API Proxy (RADAR ONLY)
app.get('/api/radar-frames', async (req, res) => {
    try {
        const rvRes = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        const data = await rvRes.json();

        // ONLY return radar timestamps (past + nowcast if present)
        const radar = {
            past: data?.radar?.past ?? [],
            nowcast: data?.radar?.nowcast ?? []
        };

        res.json({ radar });
    } catch (error) {
        console.error('Error fetching rainviewer data:', error);
        res.status(500).json({ error: 'Failed to fetch radar frames' });
    }
});

if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`BFF Node Server is running on http://localhost:${PORT}`);
    });
}

module.exports = app;
