'use strict';

const PUBLIC_ROLE_FIELDS = new Set([
  'slug',
  'displayName',
  'available',
  'sortOrder',
]);

function copyPublicRole(role) {
  return {
    slug: role.slug,
    displayName: role.displayName,
    available: role.available,
    sortOrder: role.sortOrder,
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
    return Object.freeze(copyPublicRole(role));
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
