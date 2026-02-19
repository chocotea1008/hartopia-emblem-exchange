const fs = require('fs');
const path = require('path');

const dir = '이미지소스';
try {
    const files = fs.readdirSync(dir);
    const items = [];

    const categoryMap = {
        '빛나는': 'shiny',
        '네뷸라': 'nebula',
        '무지개': 'rainbow'
    };

    files.forEach(file => {
        // Filename format: Category_Number.Description.png
        // e.g. "빛나는_1.애플잭의_도약.png"
        // Also handle potential unicode NFD/NFC if needed, but simple match usually works
        const match = file.match(/^(.+)_(\d+)\.(.+)\.png$/);

        if (match) {
            const [_, rawCat, num, desc] = match;
            const category = categoryMap[rawCat] || 'misc';

            items.push({
                id: `${category}_${num}`,
                name: file,
                src: `이미지소스/${file}`, // Relative path for HTML
                category: category,
                categoryLabel: rawCat,
                number: parseInt(num, 10),
                description: desc,
                status: 'center'
            });
        }
    });

    // Sort order: Shiny (1), Nebula (2), Rainbow (3)
    const catOrder = { 'shiny': 1, 'nebula': 2, 'rainbow': 3, 'misc': 99 };

    items.sort((a, b) => {
        if (catOrder[a.category] !== catOrder[b.category]) {
            return catOrder[a.category] - catOrder[b.category];
        }
        return a.number - b.number;
    });

    const content = `export const items = ${JSON.stringify(items, null, 2)};`;

    if (!fs.existsSync('js')) {
        fs.mkdirSync('js');
    }

    fs.writeFileSync('js/data.js', content, 'utf8');
    console.log(`Generated js/data.js with ${items.length} items.`);

} catch (err) {
    console.error('Error generating data:', err);
    process.exit(1);
}
