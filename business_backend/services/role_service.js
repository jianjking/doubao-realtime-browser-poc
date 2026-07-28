'use strict';

const PUBLIC_ROLE_FIELDS = new Set([
  'slug',
  'displayName',
  'available',
  'billingUnitMs',
  'pricePerBillingUnitFen',
  'sortOrder',
]);

function createPublicPricing(role, index) {
  if (role.billingUnitMs % 1000 !== 0) {
    throw new TypeError(
      `roles[${index}].billingUnitMs must be a whole number of seconds`
    );
  }
  const billingUnitSeconds = role.billingUnitMs / 1000;
  const billingUnitsPerMinute = Math.ceil(
    60000 / role.billingUnitMs
  );
  const pricePerMinuteFen = (
    billingUnitsPerMinute * role.pricePerBillingUnitFen
  );
  if (
    !Number.isSafeInteger(billingUnitSeconds)
    || billingUnitSeconds <= 0
    || !Number.isSafeInteger(pricePerMinuteFen)
    || pricePerMinuteFen <= 0
  ) {
    throw new TypeError(
      `roles[${index}] cannot produce safe public pricing`
    );
  }
  return {
    currency: 'CNY',
    billingUnitSeconds,
    pricePerMinuteFen,
  };
}

function copyPublicRole(role) {
  return {
    slug: role.slug,
    displayName: role.displayName,
    available: role.available,
    billingUnitMs: role.billingUnitMs,
    pricePerBillingUnitFen: role.pricePerBillingUnitFen,
    sortOrder: role.sortOrder,
    pricing: { ...role.pricing },
  };
}

function createRoleService({ roles } = {}) {
  if (!Array.isArray(roles)) {
    throw new TypeError('roles must be an array');
  }
  if (roles.length !== 8) {
    throw new TypeError('roles must contain exactly 8 items');
  }

  const slugs = new Set();
  const sortOrders = new Set();
  const validatedRoles = roles.map((role, index) => {
    if (!role || typeof role !== 'object' || Array.isArray(role)) {
      throw new TypeError(`roles[${index}] must be an object`);
    }
    const unsupportedField = Object.keys(role).find(
      (field) => !PUBLIC_ROLE_FIELDS.has(field)
    );
    if (unsupportedField) {
      throw new TypeError(
        `roles[${index}] contains unsupported field ${unsupportedField}`
      );
    }
    if (typeof role.slug !== 'string' || role.slug === '') {
      throw new TypeError(
        `roles[${index}].slug must be a non-empty string`
      );
    }
    if (slugs.has(role.slug)) {
      throw new TypeError(`Duplicate role slug: ${role.slug}`);
    }
    if (
      typeof role.displayName !== 'string'
      || role.displayName === ''
    ) {
      throw new TypeError(
        `roles[${index}].displayName must be a non-empty string`
      );
    }
    if (typeof role.available !== 'boolean') {
      throw new TypeError(
        `roles[${index}].available must be a boolean`
      );
    }
    if (
      !Number.isSafeInteger(role.billingUnitMs)
      || role.billingUnitMs <= 0
    ) {
      throw new TypeError(
        `roles[${index}].billingUnitMs must be a positive safe integer`
      );
    }
    if (
      !Number.isSafeInteger(role.pricePerBillingUnitFen)
      || role.pricePerBillingUnitFen <= 0
    ) {
      throw new TypeError(
        `roles[${index}].pricePerBillingUnitFen must be a positive safe integer`
      );
    }
    const pricing = createPublicPricing(role, index);
    if (
      !Number.isSafeInteger(role.sortOrder)
      || role.sortOrder < 1
      || role.sortOrder > 8
    ) {
      throw new TypeError(
        `roles[${index}].sortOrder must be a safe integer from 1 to 8`
      );
    }
    if (sortOrders.has(role.sortOrder)) {
      throw new TypeError(
        `Duplicate role sortOrder: ${role.sortOrder}`
      );
    }

    slugs.add(role.slug);
    sortOrders.add(role.sortOrder);
    return Object.freeze({
      ...role,
      pricing: Object.freeze(pricing),
    });
  });

  validatedRoles.sort((left, right) => (
    left.sortOrder - right.sortOrder
  ));
  const rolesBySlug = new Map(
    validatedRoles.map((role) => [role.slug, role])
  );

  function listPublicRoles() {
    return validatedRoles.map(copyPublicRole);
  }

  function findPublicRoleBySlug(slug) {
    if (typeof slug !== 'string') {
      return null;
    }
    const role = rolesBySlug.get(slug);
    return role ? copyPublicRole(role) : null;
  }

  return {
    listPublicRoles,
    findPublicRoleBySlug,
  };
}

module.exports = {
  createRoleService,
};
