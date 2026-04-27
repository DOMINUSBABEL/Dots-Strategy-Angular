const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico');
const png2icons = require('png2icons');

const SIZE = 1024;
const canvas = createCanvas(SIZE, SIZE);
const ctx = canvas.getContext('2d');

ctx.clearRect(0, 0, SIZE, SIZE);

// Optional background to make white lines visible on transparent background
ctx.fillStyle = '#1e1e1e';
ctx.beginPath();
ctx.roundRect(0, 0, SIZE, SIZE, SIZE * 0.2);
ctx.fill();

const scale = SIZE / 108;
ctx.scale(scale, scale);

ctx.lineJoin = 'round';
ctx.lineCap = 'round';

// White connecting lines
ctx.beginPath();
ctx.moveTo(34, 54);
ctx.lineTo(74, 34);
ctx.moveTo(34, 54);
ctx.lineTo(74, 74);
ctx.moveTo(74, 34);
ctx.lineTo(74, 74);
ctx.strokeStyle = '#FFFFFF';
ctx.lineWidth = 4;
ctx.stroke();

// Blue dot
ctx.beginPath();
ctx.arc(34, 54, 10, 0, Math.PI * 2);
ctx.fillStyle = '#3498db';
ctx.fill();

// Red dot
ctx.beginPath();
ctx.arc(74, 34, 10, 0, Math.PI * 2);
ctx.fillStyle = '#e74c3c';
ctx.fill();

// Purple dot
ctx.beginPath();
ctx.arc(74, 74, 10, 0, Math.PI * 2);
ctx.fillStyle = '#9b59b6';
ctx.fill();

const buildDir = path.join(__dirname, 'build');
if (!fs.existsSync(buildDir)) {
    fs.mkdirSync(buildDir);
}

const pngPath = path.join(buildDir, 'icon.png');
const icoPath = path.join(buildDir, 'icon.ico');
const icnsPath = path.join(buildDir, 'icon.icns');

const buffer = canvas.toBuffer('image/png');
fs.writeFileSync(pngPath, buffer);
console.log('Created icon.png');

const input = fs.readFileSync(pngPath);

const icoBuf = png2icons.createICO(input, png2icons.BICUBIC, 0, false, false);
if (icoBuf) {
    fs.writeFileSync(icoPath, icoBuf);
    console.log('Created icon.ico');
}

const icnsBuf = png2icons.createICNS(input, png2icons.BICUBIC, 0);
if (icnsBuf) {
    fs.writeFileSync(icnsPath, icnsBuf);
    console.log('Created icon.icns');
}
