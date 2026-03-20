class Velix < Formula
  desc "Velix AI CLI - Multi-provider AI coding assistant with swarm orchestration"
  homepage "https://github.com/cliclye/velix-cli"
  url "https://registry.npmjs.org/velix-cli/-/velix-cli-0.2.0.tgz"
  license "MIT"
  version "0.2.0"

  depends_on "node@20"

  def install
    system "npm", "install", "-g", "velix-cli@#{version}"
  end

  test do
    system "#{bin}/velix", "--version"
  end
end
