# Fast Quadric Mesh Simplification

Algoritmo: Sven Forstmann (sp4cerat), MIT.
https://github.com/sp4cerat/Fast-Quadric-Mesh-Simplification

Se distribuyen `a.out.js` y `a.out.wasm` sin modificaciones del port de
Chris Rorden / neurolabusc (MIT), basado en el algoritmo C++ anterior:
https://github.com/neurolabusc/simplifyjs
Commit: 9a535a06aa3949f43195485c6991d7485369d28a

El visor intercambia geometría mediante MZ3 binario (temporal en memoria).
No envía archivos a servidores. El formato de entrada y descarga del usuario es STL.

Licencias incluidas: LICENSE.md (algoritmo), PORT-LICENSE (distribución del port).
Three.js 0.160.0: ../three/LICENSE (MIT). Se conserva la versión del visor original;
los imports de STLLoader y OrbitControls apuntan a su copia local.
