// Local-only seeder for the real Core -> tracker -> engine regression.
#include <libtorrent/load_torrent.hpp>
#include <libtorrent/session.hpp>
#include <libtorrent/settings_pack.hpp>
#include <libtorrent/torrent_flags.hpp>
#include <libtorrent/torrent_handle.hpp>
#include <libtorrent/torrent_status.hpp>

#include <chrono>
#include <iostream>
#include <thread>

int main(int argc, char **argv) {
    if (argc != 3) return 2;
    namespace lt = libtorrent;
    lt::settings_pack settings;
    settings.set_str(lt::settings_pack::listen_interfaces, "127.0.0.1:0");
    settings.set_str(lt::settings_pack::outgoing_interfaces, "127.0.0.1");
    settings.set_bool(lt::settings_pack::enable_dht, false);
    settings.set_bool(lt::settings_pack::enable_lsd, false);
    settings.set_bool(lt::settings_pack::enable_upnp, false);
    settings.set_bool(lt::settings_pack::enable_natpmp, false);
    lt::session session(settings);
    auto torrent = lt::load_torrent_file(argv[1]);
    torrent.save_path = argv[2];
    torrent.trackers.clear();
    torrent.flags &= ~(lt::torrent_flags::paused | lt::torrent_flags::auto_managed);
    torrent.flags |= lt::torrent_flags::seed_mode | lt::torrent_flags::disable_dht
        | lt::torrent_flags::disable_lsd | lt::torrent_flags::disable_pex;
    auto handle = session.add_torrent(std::move(torrent));
    for (int attempt = 0; attempt < 100; ++attempt) {
        if (session.listen_port() && handle.status().is_seeding) {
            std::cout << "SEED_READY " << session.listen_port() << std::endl;
            std::cin.get();
            return 0;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }
    return 1;
}
