<?php

namespace Database\Seeders;

use App\Support\TestTargetGuard;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        app(TestTargetGuard::class)->check();
        $this->call(SyntheticAcceptanceSeeder::class);
    }
}
