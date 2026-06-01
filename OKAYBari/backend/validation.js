class AppError extends Error {
  constructor(status, message, code = 'BAD_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const VALID_ROLES = new Set(['admin', 'staff']);
const VALID_STATUSES = new Set(['pending', 'confirmed', 'cancelled']);

function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError(400, 'Dati non validi');
  }
  return value;
}

function cleanString(value, maxLength, fieldName, required = true) {
  if (value === undefined || value === null) {
    if (!required) return '';
    throw new AppError(400, `${fieldName} obbligatorio`);
  }

  const text = String(value).trim().replace(/\s+/g, ' ');
  if (required && !text) throw new AppError(400, `${fieldName} obbligatorio`);
  if (text.length > maxLength) throw new AppError(400, `${fieldName} troppo lungo`);
  return text;
}

function validateEmail(value, required = true) {
  const email = cleanString(value, 120, 'Email', required).toLowerCase();
  if (!email && !required) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new AppError(400, 'Email non valida');
  }
  return email;
}

function validatePassword(value) {
  const password = typeof value === 'string' ? value : '';
  if (password.length < 8) {
    throw new AppError(400, 'La password deve avere almeno 8 caratteri');
  }
  if (!/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new AppError(400, 'La password deve contenere almeno una maiuscola e un numero');
  }
  return password;
}

function validateRole(value) {
  const role = cleanString(value, 20, 'Ruolo').toLowerCase();
  if (!VALID_ROLES.has(role)) throw new AppError(400, 'Ruolo non valido');
  return role;
}

function validateStatus(value) {
  const status = cleanString(value, 20, 'Stato').toLowerCase();
  if (!VALID_STATUSES.has(status)) throw new AppError(400, 'Stato non valido');
  return status;
}

function validateDate(value) {
  const date = cleanString(value, 10, 'Data');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new AppError(400, 'Data non valida');

  const parsed = new Date(`${date}T00:00:00Z`);
  const yyyy = String(parsed.getUTCFullYear()).padStart(4, '0');
  const mm = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getUTCDate()).padStart(2, '0');
  if (`${yyyy}-${mm}-${dd}` !== date) throw new AppError(400, 'Data non valida');

  return date;
}

function validateTime(value) {
  const time = cleanString(value, 5, 'Ora');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new AppError(400, 'Ora non valida');
  }
  return time;
}

function validatePeople(value) {
  const people = Number(value);
  if (!Number.isInteger(people) || people < 1 || people > 20) {
    throw new AppError(400, 'Numero persone non valido');
  }
  return people;
}

function validatePhone(value) {
  const phone = cleanString(value, 30, 'Telefono');
  if (!/^[+0-9\s().-]{6,30}$/.test(phone)) {
    throw new AppError(400, 'Telefono non valido');
  }
  return phone;
}

function validateReservationInput(payload) {
  const body = requireObject(payload);
  return {
    name: cleanString(body.name, 80, 'Nome'),
    surname: cleanString(body.surname, 80, 'Cognome', false),
    phone: validatePhone(body.phone),
    email: validateEmail(body.email, false),
    date: validateDate(body.date),
    time: validateTime(body.time),
    people_count: validatePeople(body.people_count),
    notes: cleanString(body.notes, 500, 'Note', false),
  };
}

function validateReservationUpdate(payload) {
  const body = requireObject(payload);
  const update = {};

  if (body.status !== undefined) update.status = validateStatus(body.status);
  if (body.internal_notes !== undefined) {
    update.internal_notes = cleanString(body.internal_notes, 800, 'Note interne', false);
  }

  if (!Object.keys(update).length) {
    throw new AppError(400, 'Nessuna modifica valida');
  }

  return update;
}

function validateNewUser(payload) {
  const body = requireObject(payload);
  return {
    email: validateEmail(body.email),
    password: validatePassword(body.password),
    role: validateRole(body.role || 'staff'),
  };
}

module.exports = {
  AppError,
  validateEmail,
  validatePassword,
  validateReservationInput,
  validateReservationUpdate,
  validateNewUser,
  validateStatus,
};
