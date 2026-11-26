# Licences and provenance

Original Road Sight application modules: MIT, Copyright 2026 Raslin777.

The bundled MGU App Kit runtime and build templates come from
`cauliflowermossgrape/idrive7-apps`, commit
`2c6cfdfaa6902f1b469c3784508fadae12b577eb`, under the MIT licence in
`LICENSES/MIT-app-kit.txt`. They carry their own notices. `LICENSE-app-kit` is
also shipped in the package. The optional native GPU renderer is not included.

The owner's uploaded SOME/IP schema (689 interfaces) was consulted locally to
list the read-only notifications. Only interface, event and field **names** are
in this app (`services.js` and the manifest), because a subscription needs them.
No type definition, BMW schema file, ISTA file, SDK, firmware or key is
distributed.

The app subscribes and displays. For the car-side services it declares only
notifications: no writable field and no method, so it has no way to send a value
or a diagnostic request to the car. The built manifest also lists the head
unit's own platform interfaces (screen, lifecycle, user), which the app kit adds
to every app; those are internal to the head unit.
