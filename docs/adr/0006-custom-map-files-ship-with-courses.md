# Custom map files ship with their courses; Westwood maps never do

A course names the map file its battlefield is imported from, with the file's content hash, and the game refuses the course if the hash doesn't match. Westwood's own maps live in the install's MIX archives and are EA content, so a course over one only names it and the game reads it from the install ([ADR 0004](0004-obs-local-file-source-reading-the-install.md)). Custom maps made in Final Alert 2 belong to their authors and are freely shared in the community, so a course over one ships the map file beside its course file, crediting the author and source; a map is taken down if its author asks. These map files are data distributed alongside the GPL game, not part of it ([ADR 0003](0003-gpl-with-readers-ported-from-openra2.md)). To another streamer, a course and its custom map travel together as one course file ([ADR 0007](0007-one-file-per-course-for-operators.md)).

## Considered Options

- **Every map read from the install**: nothing third-party in the repo, but it limits courses to Westwood's maps and loses the large pool of custom maps.
- **Each streamer supplies custom maps themselves**: no redistribution at all, but a shipped course that won't play until someone finds the right file, and a hash mismatch when they find a different version.
