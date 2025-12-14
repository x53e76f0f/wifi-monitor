// example.js - Примеры использования WiFiMonitor как модуля

const WiFiMonitor = require('./wifi-monitor');

// ============================================================
// Пример 1: Простое одиночное сканирование
// ============================================================

async function example1_simpleScan() {
  console.log('\n=== Пример 1: Одиночное сканирование ===\n');
  
  const monitor = new WiFiMonitor({
    interface: 'wlp3s0'
  });

  try {
    const aps = await monitor.scanOnce();
    console.log(`\nВсего найдено: ${aps.length} точек доступа`);
    
    // Выводим все SSID
    aps.forEach(ap => {
      console.log(`- ${ap.ssid || '(hidden)'}: ${ap.signal_dbm} dBm`);
    });
  } catch (error) {
    console.error('Ошибка:', error.message);
  }
}

// ============================================================
// Пример 2: Поиск самой сильной сети на 5 GHz
// ============================================================

async function example2_findBest5GHz() {
  console.log('\n=== Пример 2: Поиск лучшей 5GHz сети ===\n');
  
  const monitor = new WiFiMonitor({
    interface: 'wlp3s0',
    format: 'json'
  });

  try {
    const aps = await monitor.scanOnce();
    
    // Фильтруем 5GHz сети (freq > 5000 MHz)
    const networks5g = aps
      .filter(ap => ap.freq_mhz && ap.freq_mhz > 5000)
      .sort((a, b) => b.signal_dbm - a.signal_dbm);
    
    if (networks5g.length > 0) {
      const best = networks5g[0];
      console.log('Лучшая 5GHz сеть:');
      console.log(`  SSID: ${best.ssid || '(hidden)'}`);
      console.log(`  Сигнал: ${best.signal_dbm} dBm`);
      console.log(`  Канал: ${best.channel}`);
      console.log(`  Безопасность: ${best.security || 'OPEN'}`);
    } else {
      console.log('5GHz сети не найдены');
    }
  } catch (error) {
    console.error('Ошибка:', error.message);
  }
}

// ============================================================
// Пример 3: Мониторинг конкретной сети
// ============================================================

async function example3_monitorNetwork(targetSSID = 'Alpha') {
  console.log(`\n=== Пример 3: Мониторинг сети "${targetSSID}" ===\n`);
  
  const monitor = new WiFiMonitor({
    interface: 'wlp3s0',
    interval: 3000, // 3 секунды
    format: 'csv'
  });

  let scanCount = 0;
  const maxScans = 10; // 10 сканирований для примера
  const signals = [];

  const interval = setInterval(async () => {
    try {
      const aps = await monitor.scan();
      const target = aps.find(ap => ap.ssid === targetSSID);
      
      if (target) {
        signals.push(target.signal_dbm);
        console.log(`[${new Date().toLocaleTimeString()}] ${targetSSID}: ${target.signal_dbm} dBm`);
      } else {
        console.log(`[${new Date().toLocaleTimeString()}] ${targetSSID}: не найдена`);
      }
      
      scanCount++;
      
      if (scanCount >= maxScans) {
        clearInterval(interval);
        
        // Статистика
        if (signals.length > 0) {
          const avg = (signals.reduce((a, b) => a + b, 0) / signals.length).toFixed(2);
          const min = Math.min(...signals);
          const max = Math.max(...signals);
          
          console.log('\nСтатистика за период:');
          console.log(`  Средний сигнал: ${avg} dBm`);
          console.log(`  Минимум: ${min} dBm`);
          console.log(`  Максимум: ${max} dBm`);
          console.log(`  Стабильность: ${(max - min).toFixed(2)} dBm разброс`);
        }
      }
    } catch (error) {
      console.error('Ошибка:', error.message);
    }
  }, 3000);
}

// ============================================================
// Пример 4: Анализ интерференции каналов
// ============================================================

async function example4_channelAnalysis() {
  console.log('\n=== Пример 4: Анализ интерференции ===\n');
  
  const monitor = new WiFiMonitor({
    interface: 'wlp3s0'
  });

  try {
    const aps = await monitor.scan();
    
    // Группируем по каналам
    const channels = {};
    aps.forEach(ap => {
      if (ap.channel) {
        if (!channels[ap.channel]) {
          channels[ap.channel] = [];
        }
        channels[ap.channel].push(ap);
      }
    });

    // Сортируем каналы по количеству сетей
    const sortedChannels = Object.entries(channels)
      .sort((a, b) => b[1].length - a[1].length);

    console.log('Загруженность каналов:');
    sortedChannels.forEach(([channel, networks]) => {
      const bar = '█'.repeat(networks.length);
      console.log(`  Канал ${channel.padStart(2)}: ${networks.length.toString().padStart(2)} сетей ${bar}`);
    });

    // Рекомендация свободного канала (2.4 GHz)
    const channels24 = [1, 6, 11]; // Непересекающиеся каналы
    const recommended = channels24
      .map(ch => ({
        channel: ch,
        count: channels[ch] ? channels[ch].length : 0
      }))
      .sort((a, b) => a.count - b.count)[0];

    console.log(`\nРекомендуемый канал для 2.4GHz: ${recommended.channel} (${recommended.count} сетей)`);
  } catch (error) {
    console.error('Ошибка:', error.message);
  }
}

// ============================================================
// Пример 5: Поиск скрытых сетей
// ============================================================

async function example5_findHiddenNetworks() {
  console.log('\n=== Пример 5: Поиск скрытых сетей ===\n');
  
  const monitor = new WiFiMonitor({
    interface: 'wlp3s0'
  });

  try {
    const aps = await monitor.scan();
    
    const hidden = aps.filter(ap => !ap.ssid || ap.ssid.trim() === '');
    
    console.log(`Найдено скрытых сетей: ${hidden.length}\n`);
    
    hidden.forEach((ap, i) => {
      console.log(`${i + 1}. BSSID: ${ap.bssid}`);
      console.log(`   Сигнал: ${ap.signal_dbm} dBm`);
      console.log(`   Канал: ${ap.channel || '?'}`);
      console.log(`   Безопасность: ${ap.security || 'OPEN'}`);
      console.log('');
    });
  } catch (error) {
    console.error('Ошибка:', error.message);
  }
}

// ============================================================
// Пример 6: Создание тепловой карты сигналов (упрощенно)
// ============================================================

async function example6_signalHeatmap() {
  console.log('\n=== Пример 6: Тепловая карта сигналов ===\n');
  
  const monitor = new WiFiMonitor({
    interface: 'wlp3s0'
  });

  try {
    const aps = await monitor.scan();
    
    // Группируем по диапазонам сигнала
    const ranges = {
      'Excellent (-30..-50)': [],
      'Good      (-50..-60)': [],
      'Fair      (-60..-70)': [],
      'Weak      (-70..-80)': [],
      'Poor      (-80..   )': []
    };

    aps.forEach(ap => {
      const signal = ap.signal_dbm;
      if (signal >= -50) ranges['Excellent (-30..-50)'].push(ap);
      else if (signal >= -60) ranges['Good      (-50..-60)'].push(ap);
      else if (signal >= -70) ranges['Fair      (-60..-70)'].push(ap);
      else if (signal >= -80) ranges['Weak      (-70..-80)'].push(ap);
      else ranges['Poor      (-80..   )'].push(ap);
    });

    console.log('Распределение сигналов:\n');
    Object.entries(ranges).forEach(([range, networks]) => {
      const count = networks.length;
      const bar = '▓'.repeat(Math.floor(count * 2));
      console.log(`${range}: ${count.toString().padStart(2)} ${bar}`);
    });
  } catch (error) {
    console.error('Ошибка:', error.message);
  }
}

// ============================================================
// Пример 7: Экспорт в разные форматы
// ============================================================

async function example7_customExport() {
  console.log('\n=== Пример 7: Кастомный экспорт ===\n');
  
  const monitor = new WiFiMonitor({
    interface: 'wlp3s0',
    format: 'json'
  });

  try {
    const aps = await monitor.scan();
    
    // Экспорт только важных полей в простой JSON
    const simplified = aps.map(ap => ({
      name: ap.ssid || 'Hidden',
      signal: ap.signal_dbm,
      channel: ap.channel,
      secure: ap.security ? true : false
    }));

    console.log('Упрощенный JSON:');
    console.log(JSON.stringify(simplified, null, 2));
    
    // Можно сохранить в файл
    const fs = require('fs');
    fs.writeFileSync('simplified_scan.json', JSON.stringify(simplified, null, 2));
    console.log('\nСохранено в simplified_scan.json');
  } catch (error) {
    console.error('Ошибка:', error.message);
  }
}

// ============================================================
// Запуск примеров
// ============================================================

async function main() {
  const examples = {
    '1': example1_simpleScan,
    '2': example2_findBest5GHz,
    '3': () => example3_monitorNetwork('Alpha'), // Замените на ваш SSID
    '4': example4_channelAnalysis,
    '5': example5_findHiddenNetworks,
    '6': example6_signalHeatmap,
    '7': example7_customExport
  };

  const exampleNum = process.argv[2] || '1';
  
  if (!examples[exampleNum]) {
    console.log('Использование: node example.js [1-7]');
    console.log('\nДоступные примеры:');
    console.log('  1 - Простое сканирование');
    console.log('  2 - Поиск лучшей 5GHz сети');
    console.log('  3 - Мониторинг конкретной сети');
    console.log('  4 - Анализ интерференции каналов');
    console.log('  5 - Поиск скрытых сетей');
    console.log('  6 - Тепловая карта сигналов');
    console.log('  7 - Кастомный экспорт данных');
    process.exit(1);
  }

  await examples[exampleNum]();
}

// Запуск только если файл выполняется напрямую
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  example1_simpleScan,
  example2_findBest5GHz,
  example3_monitorNetwork,
  example4_channelAnalysis,
  example5_findHiddenNetworks,
  example6_signalHeatmap,
  example7_customExport
};