const backend = process.env.CALENDAR_BACKEND || 'ical';
module.exports = require(`./${backend}`);
