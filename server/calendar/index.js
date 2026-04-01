const backend = process.env.CALENDAR_BACKEND || 'ical';

const backends = {
  ical: require('./ical'),
  google: require('./google'),
};

module.exports = backends[backend] || backends.ical;
