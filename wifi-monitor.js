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
    this.successfulScans = 0;
    this.failedScans = 0;
    
    // Создаем директорию для данных
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Парсинг вывода iw scan
   * @param {string} output - Вывод команды iw scan
   * @returns {Array} Массив точек доступа
   */
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

  /**
   * Выполнение сканирования с retry
   * @param {number} retries - Количество попыток
   * @param {number} retryDelay - Задержка между попытками в мс
   * @returns {Promise<Array>} Массив точек доступа
   */
  async scan(retries = 3, retryDelay = 1000) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const aps = await this._performScan();
        return aps;
      } catch (error) {
        const isBusy = error.message.includes('Device or resource busy');
        
        if (isBusy && attempt < retries) {
          console.warn(`⚠️  Интерфейс занят, попытка ${attempt}/${retries}. Ожидание ${retryDelay}мс...`);
          await this._sleep(retryDelay);
          continue;
        }
        
        throw error;
      }
    }
  }

  /**
   * Внутренний метод выполнения сканирования
   * @returns {Promise<Array>} Массив точек доступа
   * @private
   */
  async _performScan() {
    return new Promise((resolve, reject) => {
      exec(`sudo iw dev ${this.interface} scan`, { timeout: 10000 }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Scan error: ${error.message}`));
          return;
        }
        if (stderr && !stderr.includes('BSS')) {
          console.warn('⚠️  Scan warning:', stderr);
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

  /**
   * Вспомогательная функция задержки
   * @param {number} ms - Миллисекунды
   * @returns {Promise<void>}
   * @private
   */
  async _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Сохранение в CSV
   * @param {Array} aps - Массив точек доступа
   * @param {boolean} append - Добавлять к существующему файлу
   * @returns {string} Путь к файлу
   */
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

  /**
   * Сохранение в JSON
   * @param {Array} aps - Массив точек доступа
   * @returns {string} Путь к файлу
   */
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

  /**
   * Одиночное сканирование
   * @returns {Promise<Array>} Массив точек доступа
   */
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
          const ssid = ap.ssid || '(hidden)';
          const security = ap.security ? `[${ap.security.trim()}]` : '[OPEN]';
          console.log(`  ${i + 1}. ${ssid} ${security} - ${ap.signal_dbm} dBm - Ch ${ap.channel || '?'}`);
        });
      }

      return aps;
    } catch (error) {
      console.error('Ошибка сканирования:', error.message);
      throw error;
    }
  }

  /**
   * Запуск мониторинга
   */
  async startMonitoring() {
    if (this.isMonitoring) {
      console.log('⚠️  Мониторинг уже запущен!');
      return;
    }

    // Предупреждение о малом интервале
    if (this.interval < 3000) {
      console.log(`\n⚠️  ВНИМАНИЕ: Интервал ${this.interval}мс слишком мал!`);
      console.log('   Рекомендуется >= 3000мс для стабильной работы.');
      console.log('   Слишком частые сканирования могут вызывать ошибки "Device busy".\n');
    }

    console.log(`\n╔════════════════════════════════════════╗`);
    console.log(`║       Wi-Fi Monitor v1.0               ║`);
    console.log(`╚════════════════════════════════════════╝`);
    console.log(`📡 Интерфейс: ${this.interface}`);
    console.log(`⏱️  Интервал: ${this.interval / 1000} сек`);
    console.log(`💾 Формат: ${this.format}`);
    console.log(`📁 Выходная директория: ${this.outputDir}`);
    console.log(`\n⌨️  Нажмите Ctrl+C для остановки...\n`);

    this.isMonitoring = true;
    this.failedScans = 0;
    this.successfulScans = 0;

    // Первое сканирование сразу
    try {
      await this.scanOnce();
      this.successfulScans++;
    } catch (error) {
      this.failedScans++;
    }

    // Последующие сканирования по интервалу
    this.monitoringInterval = setInterval(async () => {
      if (this.isMonitoring) {
        try {
          await this.scanOnce();
          this.successfulScans++;
        } catch (error) {
          this.failedScans++;
          
          // Если слишком много неудач подряд - предупреждаем
          if (this.failedScans > 5 && this.successfulScans === 0) {
            console.log(`\n⚠️  Слишком много неудачных сканирований (${this.failedScans}).`);
            console.log('   Возможные причины:');
            console.log('   • NetworkManager занимает интерфейс');
            console.log('   • Слишком короткий интервал сканирования');
            console.log('   • Проблемы с драйвером Wi-Fi\n');
          }
        }
      }
    }, this.interval);

    // Обработка Ctrl+C
    process.on('SIGINT', () => {
      this.stopMonitoring();
    });
  }

  /**
   * Остановка мониторинга
   */
  stopMonitoring() {
    if (!this.isMonitoring) return;

    console.log('\n\n╔════════════════════════════════════════╗');
    console.log('║    Остановка мониторинга...            ║');
    console.log('╚════════════════════════════════════════╝');
    
    this.isMonitoring = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    const total = this.successfulScans + this.failedScans;
    const successRate = total > 0 ? ((this.successfulScans / total) * 100).toFixed(1) : 0;

    console.log(`\n📊 Статистика:`);
    console.log(`   Всего сканирований: ${total}`);
    console.log(`   ✓ Успешных: ${this.successfulScans}`);
    console.log(`   ✗ Неудачных: ${this.failedScans}`);
    console.log(`   📈 Успешность: ${successRate}%`);
    console.log(`\n💾 Данные сохранены в: ${this.outputDir}`);
    
    process.exit(0);
  }

  /**
   * Анализ собранных CSV данных
   * @param {string} csvPath - Путь к CSV файлу
   */
  static analyzeCSV(csvPath) {
    if (!fs.existsSync(csvPath)) {
      console.error(`Файл не найден: ${csvPath}`);
      return;
    }

    const content = fs.readFileSync(csvPath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    
    if (lines.length < 2) {
      console.log('Недостаточно данных для анализа');
      return;
    }

    const headers = lines[0].split(',');
    
    const data = lines.slice(1).map(line => {
      const values = line.split(',');
      return headers.reduce((obj, header, i) => {
        obj[header] = values[i];
        return obj;
      }, {});
    });

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║         АНАЛИЗ ДАННЫХ Wi-Fi           ║');
    console.log('╚════════════════════════════════════════╝\n');
    
    console.log(`Всего записей: ${data.length}`);
    
    // Уникальные SSID
    const ssids = new Set(data.map(d => d.ssid).filter(s => s));
    console.log(`Уникальных сетей: ${ssids.size}`);
    
    // Средний сигнал по SSID
    const signalBySSID = {};
    data.forEach(row => {
      if (row.ssid && row.signal_dbm) {
        if (!signalBySSID[row.ssid]) {
          signalBySSID[row.ssid] = { sum: 0, count: 0, min: 999, max: -999 };
        }
        const sig = parseFloat(row.signal_dbm);
        signalBySSID[row.ssid].sum += sig;
        signalBySSID[row.ssid].count++;
        signalBySSID[row.ssid].min = Math.min(signalBySSID[row.ssid].min, sig);
        signalBySSID[row.ssid].max = Math.max(signalBySSID[row.ssid].max, sig);
      }
    });

    console.log('\n┌─────────────────────────────────────────┐');
    console.log('│  Топ-10 сетей по среднему сигналу       │');
    console.log('├─────────────────────────────────────────┤');
    Object.entries(signalBySSID)
      .map(([ssid, stats]) => ({
        ssid,
        avg: (stats.sum / stats.count).toFixed(2),
        min: stats.min.toFixed(2),
        max: stats.max.toFixed(2),
        count: stats.count
      }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 10)
      .forEach(({ ssid, avg, min, max, count }, i) => {
        const name = ssid.padEnd(20).substring(0, 20);
        console.log(`│ ${(i + 1).toString().padStart(2)}. ${name} ${avg.padStart(6)} dBm (${min}..${max}) │`);
      });
    console.log('└─────────────────────────────────────────┘');

    // Распределение по каналам
    const channels = {};
    data.forEach(row => {
      if (row.channel) {
        channels[row.channel] = (channels[row.channel] || 0) + 1;
      }
    });

    console.log('\n┌─────────────────────────────────────────┐');
    console.log('│  Интерференция (записей на канал)      │');
    console.log('├─────────────────────────────────────────┤');
    Object.entries(channels)
      .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
      .forEach(([ch, count]) => {
        const bar = '█'.repeat(Math.min(count / 10, 30));
        console.log(`│ Канал ${ch.padStart(2)}: ${count.toString().padStart(4)} ${bar.padEnd(30)} │`);
      });
    console.log('└─────────────────────────────────────────┘');

    // Безопасность
    const security = {};
    data.forEach(row => {
      const sec = row.security ? row.security.trim() : 'OPEN';
      security[sec] = (security[sec] || 0) + 1;
    });

    console.log('\n┌─────────────────────────────────────────┐');
    console.log('│  Распределение по типу безопасности     │');
    console.log('├─────────────────────────────────────────┤');
    Object.entries(security)
      .sort((a, b) => b[1] - a[1])
      .forEach(([sec, count]) => {
        const name = sec.padEnd(15).substring(0, 15);
        console.log(`│ ${name}: ${count.toString().padStart(4)} записей               │`);
      });
    console.log('└─────────────────────────────────────────┘\n');
  }
}

// ============================================================
// CLI интерфейс
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
╔════════════════════════════════════════════════════════════╗
║              Wi-Fi Network Monitor v1.0                    ║
╚════════════════════════════════════════════════════════════╝

ИСПОЛЬЗОВАНИЕ:
  node wifi-monitor.js [опции]

ОПЦИИ:
  --interface, -i <name>   Сетевой интерфейс (по умолчанию: wlp3s0)
  --interval, -t <ms>      Интервал сканирования в мс (по умолчанию: 5000)
  --output, -o <dir>       Директория для сохранения (по умолчанию: ./wifi_data)
  --format, -f <format>    Формат вывода: csv, json, both (по умолчанию: both)
  --once                   Выполнить одно сканирование и выйти
  --analyze <file>         Анализировать CSV файл
  --help, -h               Показать эту справку

ПРИМЕРЫ:
  # Непрерывный мониторинг с настройками по умолчанию
  node wifi-monitor.js

  # Использование другого интерфейса и интервала
  node wifi-monitor.js --interface wlan0 --interval 10000 --format csv

  # Одно сканирование
  node wifi-monitor.js --once

  # Анализ собранных данных
  node wifi-monitor.js --analyze ./wifi_data/wifi_scan.csv

ТРЕБОВАНИЯ:
  - Linux с установленным iw
  - sudo права для выполнения iw scan
  - Node.js >= 12.0.0

ДАННЫЕ:
  Собираемые параметры: BSSID, SSID, частота, канал, уровень сигнала,
  безопасность (WPA/WPA2/WPA3), стандарты Wi-Fi (802.11n/ac/ax),
  beacon interval, country code и др.
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
      console.error('Ошибка: Укажите путь к CSV файлу');
      console.log('Пример: node wifi-monitor.js --analyze ./wifi_data/wifi_scan.csv');
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