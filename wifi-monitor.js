// wifi-monitor.js - Мониторинг Wi-Fi сетей на Node.js
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class WiFiMonitor {
  constructor(options = {}) {
    this.interface = options.interface || 'wlp3s0';
    this.interval = options.interval || 5000; // 5 секунд
    this.outputDir = options.outputDir || './wifi_data';
    this.format = options.format || 'both'; // 'csv', 'json', 'both'
    this.isMonitoring = false;
    this.scanCount = 0;
    
    // Создаем директорию для данных
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  // Парсинг вывода iw scan
  parseIwScan(output) {
    const aps = [];
    const lines = output.split('\n');
    let currentAp = null;
    let bssid = null;

    for (const line of lines) {
      // Начало новой AP
      const bssMatch = line.match(/^BSS ([0-9a-f:]{17})/);
      if (bssMatch) {
        if (currentAp && bssid) {
          currentAp.bssid = bssid;
          aps.push(currentAp);
        }
        currentAp = {
          timestamp: new Date().toISOString(),
          interface: this.interface
        };
        bssid = bssMatch[1];
        continue;
      }

      if (!currentAp) continue;

      // Частота
      const freqMatch = line.match(/^\s*freq:\s*(\d+)/);
      if (freqMatch) {
        currentAp.freq_mhz = parseInt(freqMatch[1]);
        continue;
      }

      // Сигнал
      const signalMatch = line.match(/^\s*signal:\s*(-?\d+(?:\.\d+)?)\s*dBm/);
      if (signalMatch) {
        currentAp.signal_dbm = parseFloat(signalMatch[1]);
        continue;
      }

      // Последний раз виден
      const lastSeenMatch = line.match(/^\s*last seen:\s*(\d+)\s*ms/);
      if (lastSeenMatch) {
        currentAp.last_seen_ms = parseInt(lastSeenMatch[1]);
        continue;
      }

      // SSID
      const ssidMatch = line.match(/^\s*SSID:\s*(.*)/);
      if (ssidMatch) {
        currentAp.ssid = ssidMatch[1] || '';
        continue;
      }

      // Канал
      const channelMatch = line.match(/^\s*DS Parameter set:\s*channel\s*(\d+)/);
      if (channelMatch) {
        currentAp.channel = parseInt(channelMatch[1]);
        continue;
      }

      // Capability
      const capMatch = line.match(/^\s*capability:\s*(.*)/);
      if (capMatch) {
        currentAp.capability = capMatch[1].trim();
        continue;
      }

      // Beacon interval
      const beaconMatch = line.match(/^\s*beacon int:\s*(\d+)/);
      if (beaconMatch) {
        currentAp.beacon_interval = parseInt(beaconMatch[1]);
        continue;
      }

      // Страна
      const countryMatch = line.match(/^\s*Country:\s*([A-Z]{2})/);
      if (countryMatch) {
        currentAp.country = countryMatch[1];
        continue;
      }

      // HT Capabilities (802.11n)
      if (line.match(/^\s*HT capabilities/)) {
        currentAp.ht_cap = '802.11n';
        continue;
      }

      // VHT Capabilities (802.11ac)
      if (line.match(/^\s*VHT capabilities/)) {
        currentAp.vht_cap = '802.11ac';
        continue;
      }

      // HE Capabilities (802.11ax / Wi-Fi 6)
      if (line.match(/^\s*HE capabilities/)) {
        currentAp.he_cap = '802.11ax';
        continue;
      }

      // Безопасность
      if (line.match(/WPA:\s*Version/)) {
        currentAp.security = (currentAp.security || '') + 'WPA1 ';
      }
      if (line.match(/RSN:\s*Version/)) {
        currentAp.security = (currentAp.security || '') + 'WPA2 ';
      }
      if (line.match(/WLAN_KEY_MGMT_SAE/)) {
        currentAp.security = (currentAp.security || '') + 'WPA3 ';
      }
    }

    // Добавляем последнюю AP
    if (currentAp && bssid) {
      currentAp.bssid = bssid;
      aps.push(currentAp);
    }

    return aps;
  }

  // Выполнение сканирования
  async scan() {
    return new Promise((resolve, reject) => {
      exec(`sudo iw dev ${this.interface} scan`, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Scan error: ${error.message}`));
          return;
        }
        if (stderr) {
          console.warn('Scan warning:', stderr);
        }
        
        try {
          const aps = this.parseIwScan(stdout);
          resolve(aps);
        } catch (parseError) {
          reject(new Error(`Parse error: ${parseError.message}`));
        }
      });
    });
  }

  // Сохранение в CSV
  saveToCSV(aps, append = false) {
    const csvPath = path.join(this.outputDir, 'wifi_scan.csv');
    const headers = [
      'timestamp', 'interface', 'bssid', 'ssid', 'freq_mhz', 
      'channel', 'signal_dbm', 'last_seen_ms', 'capability', 
      'security', 'beacon_interval', 'country', 'ht_cap', 'vht_cap', 'he_cap'
    ];

    let content = '';
    
    // Добавляем заголовки если файл новый
    if (!append || !fs.existsSync(csvPath)) {
      content = headers.join(',') + '\n';
    }

    // Добавляем данные
    for (const ap of aps) {
      const row = headers.map(h => {
        const val = ap[h];
        if (val === undefined || val === null) return '';
        // Экранируем значения с запятыми
        const str = String(val);
        return str.includes(',') ? `"${str}"` : str;
      });
      content += row.join(',') + '\n';
    }

    fs.appendFileSync(csvPath, content);
    return csvPath;
  }

  // Сохранение в JSON
  saveToJSON(aps) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = path.join(this.outputDir, `wifi_scan_${timestamp}.json`);
    
    const data = {
      timestamp: new Date().toISOString(),
      interface: this.interface,
      scan_count: this.scanCount,
      total_aps: aps.length,
      access_points: aps
    };

    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
    return jsonPath;
  }

  // Одиночное сканирование
  async scanOnce() {
    console.log(`\n[${new Date().toLocaleString()}] Сканирование...`);
    
    try {
      const aps = await this.scan();
      console.log(`Найдено сетей: ${aps.length}`);
      
      // Сохраняем данные
      if (this.format === 'csv' || this.format === 'both') {
        const csvPath = this.saveToCSV(aps, true);
        console.log(`CSV: ${csvPath}`);
      }
      
      if (this.format === 'json' || this.format === 'both') {
        const jsonPath = this.saveToJSON(aps);
        console.log(`JSON: ${jsonPath}`);
      }

      this.scanCount++;
      
      // Показываем топ-5 сильных сигналов
      const sorted = aps
        .filter(ap => ap.signal_dbm)
        .sort((a, b) => b.signal_dbm - a.signal_dbm)
        .slice(0, 5);
      
      if (sorted.length > 0) {
        console.log('\nТоп-5 сильных сигналов:');
        sorted.forEach((ap, i) => {
          console.log(`  ${i + 1}. ${ap.ssid || '(hidden)'} - ${ap.signal_dbm} dBm - ${ap.bssid}`);
        });
      }

      return aps;
    } catch (error) {
      console.error('Ошибка сканирования:', error.message);
      throw error;
    }
  }

  // Запуск мониторинга
  async startMonitoring() {
    if (this.isMonitoring) {
      console.log('Мониторинг уже запущен!');
      return;
    }

    console.log(`\n=== Wi-Fi Monitor ===`);
    console.log(`Интерфейс: ${this.interface}`);
    console.log(`Интервал: ${this.interval / 1000} сек`);
    console.log(`Формат: ${this.format}`);
    console.log(`Выходная директория: ${this.outputDir}`);
    console.log(`\nНажмите Ctrl+C для остановки...\n`);

    this.isMonitoring = true;

    // Первое сканирование сразу
    await this.scanOnce();

    // Последующие сканирования по интервалу
    this.monitoringInterval = setInterval(async () => {
      if (this.isMonitoring) {
        await this.scanOnce();
      }
    }, this.interval);

    // Обработка Ctrl+C
    process.on('SIGINT', () => {
      this.stopMonitoring();
    });
  }

  // Остановка мониторинга
  stopMonitoring() {
    if (!this.isMonitoring) return;

    console.log('\n\nОстановка мониторинга...');
    this.isMonitoring = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    console.log(`Всего выполнено сканирований: ${this.scanCount}`);
    console.log(`Данные сохранены в: ${this.outputDir}`);
    process.exit(0);
  }

  // Анализ собранных данных
  static analyzeCSV(csvPath) {
    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    const headers = lines[0].split(',');
    
    const data = lines.slice(1).map(line => {
      const values = line.split(',');
      return headers.reduce((obj, header, i) => {
        obj[header] = values[i];
        return obj;
      }, {});
    });

    console.log('\n=== Анализ данных ===');
    console.log(`Всего записей: ${data.length}`);
    
    // Уникальные SSID
    const ssids = new Set(data.map(d => d.ssid).filter(s => s));
    console.log(`Уникальных сетей: ${ssids.size}`);
    
    // Средний сигнал по SSID
    const signalBySSID = {};
    data.forEach(row => {
      if (row.ssid && row.signal_dbm) {
        if (!signalBySSID[row.ssid]) {
          signalBySSID[row.ssid] = { sum: 0, count: 0 };
        }
        signalBySSID[row.ssid].sum += parseFloat(row.signal_dbm);
        signalBySSID[row.ssid].count++;
      }
    });

    console.log('\nСредний сигнал по сетям:');
    Object.entries(signalBySSID)
      .map(([ssid, stats]) => ({
        ssid,
        avg: (stats.sum / stats.count).toFixed(2)
      }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 10)
      .forEach(({ ssid, avg }) => {
        console.log(`  ${ssid}: ${avg} dBm`);
      });

    // Распределение по каналам
    const channels = {};
    data.forEach(row => {
      if (row.channel) {
        channels[row.channel] = (channels[row.channel] || 0) + 1;
      }
    });

    console.log('\nИнтерференция (записей на канал):');
    Object.entries(channels)
      .sort((a, b) => b[1] - a[1])
      .forEach(([ch, count]) => {
        console.log(`  Канал ${ch}: ${count} записей`);
      });
  }
}

// CLI интерфейс
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Использование: node wifi-monitor.js [опции]

Опции:
  --interface, -i <name>   Сетевой интерфейс (по умолчанию: wlp3s0)
  --interval, -t <ms>      Интервал сканирования в мс (по умолчанию: 5000)
  --output, -o <dir>       Директория для сохранения (по умолчанию: ./wifi_data)
  --format, -f <format>    Формат вывода: csv, json, both (по умолчанию: both)
  --once                   Выполнить одно сканирование и выйти
  --analyze <file>         Анализировать CSV файл
  --help, -h               Показать эту справку

Примеры:
  node wifi-monitor.js
  node wifi-monitor.js --interface wlan0 --interval 10000 --format csv
  node wifi-monitor.js --once
  node wifi-monitor.js --analyze ./wifi_data/wifi_scan.csv
    `);
    process.exit(0);
  }

  const options = {
    interface: args[args.indexOf('-i') + 1] || args[args.indexOf('--interface') + 1] || 'wlp3s0',
    interval: parseInt(args[args.indexOf('-t') + 1] || args[args.indexOf('--interval') + 1]) || 5000,
    outputDir: args[args.indexOf('-o') + 1] || args[args.indexOf('--output') + 1] || './wifi_data',
    format: args[args.indexOf('-f') + 1] || args[args.indexOf('--format') + 1] || 'both'
  };

  const monitor = new WiFiMonitor(options);

  // Анализ
  if (args.includes('--analyze')) {
    const csvFile = args[args.indexOf('--analyze') + 1];
    if (!csvFile) {
      console.error('Укажите путь к CSV файлу');
      process.exit(1);
    }
    WiFiMonitor.analyzeCSV(csvFile);
    process.exit(0);
  }

  // Одно сканирование
  if (args.includes('--once')) {
    monitor.scanOnce()
      .then(() => process.exit(0))
      .catch(err => {
        console.error(err);
        process.exit(1);
      });
  } else {
    // Непрерывный мониторинг
    monitor.startMonitoring();
  }
}

module.exports = WiFiMonitor;

// ===== package.json =====
/*
{
  "name": "wifi-monitor",
  "version": "1.0.0",
  "description": "Wi-Fi network monitoring tool using iw scan",
  "main": "wifi-monitor.js",
  "scripts": {
    "start": "node wifi-monitor.js",
    "scan": "node wifi-monitor.js --once",
    "analyze": "node wifi-monitor.js --analyze ./wifi_data/wifi_scan.csv"
  },
  "keywords": ["wifi", "monitoring", "iw", "scan", "network"],
  "author": "",
  "license": "MIT"
}
*/

// ===== Пример использования как модуля =====
/*
const WiFiMonitor = require('./wifi-monitor');

// Создание монитора
const monitor = new WiFiMonitor({
  interface: 'wlp3s0',
  interval: 5000,
  outputDir: './wifi_data',
  format: 'both' // 'csv', 'json', 'both'
});

// Одиночное сканирование
async function singleScan() {
  try {
    const aps = await monitor.scanOnce();
    console.log(`Найдено ${aps.length} точек доступа`);
    
    // Работа с результатами
    aps.forEach(ap => {
      console.log(`${ap.ssid || '(hidden)'}: ${ap.signal_dbm} dBm`);
    });
  } catch (error) {
    console.error('Ошибка:', error);
  }
}

// Непрерывный мониторинг
async function continuousMonitoring() {
  await monitor.startMonitoring();
}

// Анализ собранных данных
function analyzeData() {
  WiFiMonitor.analyzeCSV('./wifi_data/wifi_scan.csv');
}
*/